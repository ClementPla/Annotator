//! Per-channel value statistics, computed once per decoded frame.

use rayon::prelude::*;

use super::raw::{RawFrame, Samples};

/// Bins of a float channel's histogram, spread over its value range.
const FLOAT_BINS: usize = 4096;

/// One channel's range and histogram. Integer channels are counted exactly:
/// one bin per value (256 or 65 536).
#[derive(Debug, Clone, PartialEq)]
pub struct ChannelStats {
    pub min: f32,
    pub max: f32,
    /// Value of bin 0 and the width of one bin.
    pub bin_start: f32,
    pub bin_width: f32,
    pub counts: Vec<u32>,
}

impl ChannelStats {
    /// The value below which `q` (0–1) of the pixels fall.
    pub fn percentile(&self, q: f64) -> f32 {
        let total: u64 = self.counts.iter().map(|&c| c as u64).sum();
        if total == 0 {
            return self.min;
        }
        let target = (q.clamp(0.0, 1.0) * total as f64).ceil().max(1.0) as u64;
        let mut seen = 0u64;
        for (i, &c) in self.counts.iter().enumerate() {
            seen += c as u64;
            if seen >= target {
                return self.bin_start + i as f32 * self.bin_width;
            }
        }
        self.max
    }

    /// The counts regrouped into `bins` bins over `[lo, hi]`, for drawing.
    /// Values outside the range are left out.
    pub fn rebin(&self, bins: usize, lo: f32, hi: f32) -> Vec<u32> {
        let mut out = vec![0u32; bins.max(1)];
        let span = (hi - lo).max(f32::EPSILON);
        for (i, &c) in self.counts.iter().enumerate() {
            if c == 0 {
                continue;
            }
            let v = self.bin_start + i as f32 * self.bin_width;
            if v < lo || v > hi {
                continue;
            }
            let b = (((v - lo) / span) * bins as f32) as usize;
            out[b.min(bins - 1)] += c;
        }
        out
    }
}

/// Statistics of every channel of `frame`.
pub fn compute(frame: &RawFrame) -> Vec<ChannelStats> {
    let plane = frame.plane_len();
    (0..frame.channels)
        .into_par_iter()
        .map(|c| {
            let range = c * plane..(c + 1) * plane;
            match &frame.samples {
                Samples::U8(v) => integer_stats(&v[range], 256),
                Samples::U16(v) => integer_stats(&v[range], 65536),
                Samples::F32(v) => float_stats(&v[range]),
            }
        })
        .collect()
}

fn integer_stats<T: Copy + Into<u32>>(values: &[T], levels: usize) -> ChannelStats {
    let mut counts = vec![0u32; levels];
    for &v in values {
        counts[v.into() as usize] += 1;
    }
    let first = counts.iter().position(|&c| c > 0).unwrap_or(0);
    let last = counts.iter().rposition(|&c| c > 0).unwrap_or(0);
    ChannelStats {
        min: first as f32,
        max: last as f32,
        bin_start: 0.0,
        bin_width: 1.0,
        counts,
    }
}

fn float_stats(values: &[f32]) -> ChannelStats {
    let (mut min, mut max) = (f32::INFINITY, f32::NEG_INFINITY);
    for &v in values.iter().filter(|v| v.is_finite()) {
        min = min.min(v);
        max = max.max(v);
    }
    if !min.is_finite() {
        (min, max) = (0.0, 0.0);
    }
    let width = ((max - min) / FLOAT_BINS as f32).max(f32::EPSILON);
    let mut counts = vec![0u32; FLOAT_BINS];
    for &v in values.iter().filter(|v| v.is_finite()) {
        let b = ((v - min) / width) as usize;
        counts[b.min(FLOAT_BINS - 1)] += 1;
    }
    ChannelStats {
        min,
        max,
        bin_start: min,
        bin_width: width,
        counts,
    }
}

/// Bits needed for the largest value of 16-bit data: 12 for a 12-bit camera
/// stored in 16 bits. `None` for other types.
pub fn significant_bits(frame: &RawFrame, stats: &[ChannelStats]) -> Option<u8> {
    match frame.samples {
        Samples::U16(_) => {
            let max = stats.iter().map(|s| s.max as u32).max().unwrap_or(0);
            Some((32 - max.leading_zeros()).max(1) as u8)
        }
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn frame16(values: Vec<u16>, channels: usize) -> RawFrame {
        let plane = values.len() / channels;
        RawFrame {
            width: plane as u32,
            height: 1,
            channels,
            samples: Samples::U16(values),
        }
    }

    #[test]
    fn integer_histogram_is_exact() {
        let f = frame16(vec![0, 4095, 4095, 100, 7, 8, 9, 10], 2);
        let s = compute(&f);
        assert_eq!((s[0].min, s[0].max), (0.0, 4095.0));
        assert_eq!(s[0].counts[4095], 2);
        assert_eq!((s[1].min, s[1].max), (7.0, 10.0));
        assert_eq!(significant_bits(&f, &s), Some(12));
    }

    #[test]
    fn percentiles_ignore_outliers() {
        // 1000 pixels at 100..=1099 plus one hot pixel.
        let mut v: Vec<u16> = (100..1100).collect();
        v.push(60000);
        let s = compute(&frame16(v, 1));
        assert_eq!(s[0].max, 60000.0);
        assert!((s[0].percentile(0.005) - 104.0).abs() <= 1.0);
        assert!((s[0].percentile(0.995) - 1094.0).abs() <= 1.0);
    }

    #[test]
    fn float_channels_are_binned_over_their_range() {
        let f = RawFrame {
            width: 4,
            height: 1,
            channels: 1,
            samples: Samples::F32(vec![-1.0, 0.0, 1.0, f32::NAN]),
        };
        let s = compute(&f);
        assert_eq!((s[0].min, s[0].max), (-1.0, 1.0));
        assert_eq!(s[0].counts.iter().sum::<u32>(), 3);
        assert_eq!(significant_bits(&f, &s), None);
    }

    #[test]
    fn rebin_keeps_counts_in_range() {
        let s = compute(&frame16(vec![0, 10, 20, 30, 40], 1));
        let bins = s[0].rebin(2, 0.0, 40.0);
        assert_eq!(bins.iter().sum::<u32>(), 5);
        assert_eq!(s[0].rebin(4, 10.0, 30.0).iter().sum::<u32>(), 3);
    }
}
