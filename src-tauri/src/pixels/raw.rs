//! A frame's pixels at their native depth, decoded once.

use std::io::Cursor;

use crate::utils::error::Result;
use crate::utils::AppError;

/// Samples of every channel, planar: channel 0's plane, then channel 1's, …
#[derive(Debug, Clone, PartialEq)]
pub enum Samples {
    U8(Vec<u8>),
    U16(Vec<u16>),
    F32(Vec<f32>),
}

/// The stored sample type, as the frontend names it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SampleType {
    U8,
    U16,
    F32,
}

impl SampleType {
    pub fn as_str(self) -> &'static str {
        match self {
            SampleType::U8 => "u8",
            SampleType::U16 => "u16",
            SampleType::F32 => "f32",
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct RawFrame {
    pub width: u32,
    pub height: u32,
    pub channels: usize,
    pub samples: Samples,
}

impl RawFrame {
    pub fn plane_len(&self) -> usize {
        self.width as usize * self.height as usize
    }

    pub fn sample_type(&self) -> SampleType {
        match self.samples {
            Samples::U8(_) => SampleType::U8,
            Samples::U16(_) => SampleType::U16,
            Samples::F32(_) => SampleType::F32,
        }
    }

    /// Memory held by the samples, for the cache budget.
    pub fn byte_size(&self) -> usize {
        match &self.samples {
            Samples::U8(v) => v.len(),
            Samples::U16(v) => v.len() * 2,
            Samples::F32(v) => v.len() * 4,
        }
    }

    /// Channel `c` at pixel index `i` (`y * width + x`).
    #[inline]
    pub fn value(&self, c: usize, i: usize) -> f32 {
        let at = c * self.plane_len() + i;
        match &self.samples {
            Samples::U8(v) => v[at] as f32,
            Samples::U16(v) => v[at] as f32,
            Samples::F32(v) => v[at],
        }
    }

    /// An 8-bit image of 3 channels: what a photograph decodes to. Displayed
    /// as is, without windowing.
    pub fn is_rgb8(&self) -> bool {
        self.sample_type() == SampleType::U8 && self.channels == 3
    }
}

/// Decode stored image bytes. A TIFF with several pages of the same size is
/// read as one channel per page; anything else goes through `image`. Alpha is
/// dropped: annotation backdrops have none that matters.
pub fn decode(bytes: &[u8]) -> Result<RawFrame> {
    if is_tiff(bytes) {
        if let Some(frame) = decode_multipage_tiff(bytes)? {
            return Ok(frame);
        }
    }
    let img = image::load_from_memory(bytes)
        .map_err(|e| AppError::Generic(format!("Failed to decode image: {e}")))?;
    Ok(from_dynamic(img))
}

fn is_tiff(bytes: &[u8]) -> bool {
    bytes.starts_with(b"II*\0") || bytes.starts_with(b"MM\0*")
}

/// Planar samples from interleaved ones, keeping the first `keep` of every
/// `stride` values per pixel.
fn deinterleave<T: Copy + Default>(src: &[T], stride: usize, keep: usize, plane: usize) -> Vec<T> {
    let mut out = vec![T::default(); plane * keep];
    for i in 0..plane {
        for c in 0..keep {
            out[c * plane + i] = src[i * stride + c];
        }
    }
    out
}

fn from_dynamic(img: image::DynamicImage) -> RawFrame {
    use image::DynamicImage as D;
    let (width, height) = (img.width(), img.height());
    let plane = width as usize * height as usize;
    let (channels, samples) = match img {
        D::ImageLuma8(b) => (1, Samples::U8(b.into_raw())),
        D::ImageLumaA8(b) => (1, Samples::U8(deinterleave(&b.into_raw(), 2, 1, plane))),
        D::ImageRgb8(b) => (3, Samples::U8(deinterleave(&b.into_raw(), 3, 3, plane))),
        D::ImageRgba8(b) => (3, Samples::U8(deinterleave(&b.into_raw(), 4, 3, plane))),
        D::ImageLuma16(b) => (1, Samples::U16(b.into_raw())),
        D::ImageLumaA16(b) => (1, Samples::U16(deinterleave(&b.into_raw(), 2, 1, plane))),
        D::ImageRgb16(b) => (3, Samples::U16(deinterleave(&b.into_raw(), 3, 3, plane))),
        D::ImageRgba16(b) => (3, Samples::U16(deinterleave(&b.into_raw(), 4, 3, plane))),
        D::ImageRgb32F(b) => (3, Samples::F32(deinterleave(&b.into_raw(), 3, 3, plane))),
        D::ImageRgba32F(b) => (3, Samples::F32(deinterleave(&b.into_raw(), 4, 3, plane))),
        // Future variants: the 8-bit RGB view always exists.
        other => {
            let rgb = other.to_rgb8();
            (3, Samples::U8(deinterleave(&rgb.into_raw(), 3, 3, plane)))
        }
    };
    RawFrame {
        width,
        height,
        channels,
        samples,
    }
}

/// One channel per page, when every page is a single-sample image of the same
/// size and type. `None` for a single page or a layout this does not cover,
/// which `image` then decodes.
fn decode_multipage_tiff(bytes: &[u8]) -> Result<Option<RawFrame>> {
    use tiff::decoder::{Decoder, DecodingResult};

    let err = |e: tiff::TiffError| AppError::Generic(format!("Failed to read TIFF: {e}"));
    let mut dec = Decoder::new(Cursor::new(bytes)).map_err(err)?;
    let mut pages: Vec<DecodingResult> = Vec::new();
    let (mut width, mut height) = (0, 0);
    loop {
        let (w, h) = dec.dimensions().map_err(err)?;
        let single_sample = matches!(dec.colortype().map_err(err)?, tiff::ColorType::Gray(_));
        if !single_sample || (!pages.is_empty() && (w, h) != (width, height)) {
            return Ok(None);
        }
        (width, height) = (w, h);
        pages.push(dec.read_image().map_err(err)?);
        if !dec.more_images() {
            break;
        }
        dec.next_image().map_err(err)?;
    }
    if pages.len() < 2 {
        return Ok(None);
    }

    let channels = pages.len();
    let samples = match &pages[0] {
        DecodingResult::U8(_) => Samples::U8(concat_pages(&pages, |p| match p {
            DecodingResult::U8(v) => Some(v.as_slice()),
            _ => None,
        })?),
        DecodingResult::U16(_) => Samples::U16(concat_pages(&pages, |p| match p {
            DecodingResult::U16(v) => Some(v.as_slice()),
            _ => None,
        })?),
        DecodingResult::F32(_) => Samples::F32(concat_pages(&pages, |p| match p {
            DecodingResult::F32(v) => Some(v.as_slice()),
            _ => None,
        })?),
        _ => return Ok(None),
    };
    Ok(Some(RawFrame {
        width,
        height,
        channels,
        samples,
    }))
}

fn concat_pages<T: Copy>(
    pages: &[tiff::decoder::DecodingResult],
    view: impl Fn(&tiff::decoder::DecodingResult) -> Option<&[T]>,
) -> Result<Vec<T>> {
    let mut out = Vec::new();
    for page in pages {
        let slice = view(page)
            .ok_or_else(|| AppError::Generic("TIFF pages differ in sample type".into()))?;
        out.extend_from_slice(slice);
    }
    Ok(out)
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{ImageBuffer, Luma, Rgb, Rgba};

    fn png(img: image::DynamicImage) -> Vec<u8> {
        let mut out = Vec::new();
        img.write_to(&mut Cursor::new(&mut out), image::ImageFormat::Png)
            .unwrap();
        out
    }

    #[test]
    fn a_16_bit_grey_png_keeps_its_values() {
        let img =
            ImageBuffer::<Luma<u16>, _>::from_fn(3, 2, |x, y| Luma([(x + 10 * y) as u16 * 1000]));
        let f = decode(&png(image::DynamicImage::ImageLuma16(img))).unwrap();
        assert_eq!((f.width, f.height, f.channels), (3, 2, 1));
        assert_eq!(
            f.samples,
            Samples::U16(vec![0, 1000, 2000, 10000, 11000, 12000])
        );
    }

    #[test]
    fn rgb16_is_planar_and_alpha_is_dropped() {
        let img = ImageBuffer::<Rgba<u16>, _>::from_fn(2, 1, |x, _| {
            let v = x as u16;
            Rgba([100 + v, 200 + v, 300 + v, 65535])
        });
        let f = decode(&png(image::DynamicImage::ImageRgba16(img))).unwrap();
        assert_eq!(f.channels, 3);
        assert_eq!(f.samples, Samples::U16(vec![100, 101, 200, 201, 300, 301]));
        assert_eq!(f.value(2, 1), 301.0);
    }

    #[test]
    fn an_8_bit_photo_is_rgb8() {
        let img = ImageBuffer::<Rgb<u8>, _>::from_pixel(2, 2, Rgb([1, 2, 3]));
        let f = decode(&png(image::DynamicImage::ImageRgb8(img))).unwrap();
        assert!(f.is_rgb8());
        assert_eq!(f.byte_size(), 12);
    }

    #[test]
    fn a_multipage_tiff_is_one_channel_per_page() {
        use tiff::encoder::{colortype, TiffEncoder};
        let mut out = Vec::new();
        {
            let mut enc = TiffEncoder::new(Cursor::new(&mut out)).unwrap();
            enc.write_image::<colortype::Gray16>(2, 2, &[1, 2, 3, 4])
                .unwrap();
            enc.write_image::<colortype::Gray16>(2, 2, &[10, 20, 30, 40])
                .unwrap();
            enc.write_image::<colortype::Gray16>(2, 2, &[100, 200, 300, 400])
                .unwrap();
        }
        let f = decode(&out).unwrap();
        assert_eq!((f.width, f.height, f.channels), (2, 2, 3));
        assert_eq!(
            f.samples,
            Samples::U16(vec![1, 2, 3, 4, 10, 20, 30, 40, 100, 200, 300, 400])
        );
    }

    #[test]
    fn a_single_page_tiff_goes_through_image() {
        use tiff::encoder::{colortype, TiffEncoder};
        let mut out = Vec::new();
        {
            let mut enc = TiffEncoder::new(Cursor::new(&mut out)).unwrap();
            enc.write_image::<colortype::Gray16>(2, 1, &[7, 4095])
                .unwrap();
        }
        let f = decode(&out).unwrap();
        assert_eq!(f.channels, 1);
        assert_eq!(f.samples, Samples::U16(vec![7, 4095]));
    }
}
