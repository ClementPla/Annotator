# Assisted labelling

There are two kinds of help. The first needs no setup. The second needs a model
download and a few annotated frames.

## Operators bounded by your stroke

These need nothing installed and run instantly. They all work the same way: paint
roughly over a region with the brush, then apply an operator. The operator only
changes pixels inside the area your stroke covered.

| Operator | What it does |
| --- | --- |
| Dynamic Otsu | Thresholds within the stroke, choosing the split automatically |
| Flood fill | Grows from the stroke while pixels stay within a tolerance |
| Superpixel selection | Snaps the mask to superpixel boundaries ([experimental](../experimental.md#superpixel-selection)) |
| Connected-component erasure | Removes the connected region you click |

Otsu and flood fill share three options:

- **Smooth** rounds the outline. Its strength is relative to the brush size:
  at 100 %, what is narrower than about half the brush is rounded off.
- **Fill holes** fills the holes enclosed in the selection.
- **Force connectivity** keeps only the largest region.

Otsu also has **Denoise**, which blurs the image before thresholding it, so
that pixel noise does not end up in the outline.

<video src="../../assets/screenshots/assisted_labelling.webm" poster="../../assets/screenshots/assisted_labelling_poster.jpg"
       autoplay loop muted playsinline controls preload="metadata" style="width: 100%"
       aria-label="A rough stroke refined with Otsu, traced into a shape, adjusted point by point, then painted back into the mask."></video>

### Correcting the result by hand

When the operator gets the outline almost right, fix it as a shape instead of
repainting it. This is the second half of the video above:

1. **Trace outline** (++v++): click the mask to get its border as a shape.
2. **Edit points**: drag the points that are off.
3. **Rasterize**: paint the corrected shape back into the mask.

See [Converting between masks and shapes](annotating.md#converting-between-masks-and-shapes).

### Adjustments can feed the operators

Brightness, contrast, gamma, tone curves and inversion normally change not only affect what you see, but the operators too.

Use this on low-contrast images.

## Training a model on your own data

!!! warning "This is very experimental"
    The following section describes what is currently mostly a "proof of concept". It is very lightly tested and will likely change a lot in the future.

Scribble on a few frames, train, and apply the result to the rest of the project.

A frozen self-supervised encoder (DINO by default) produces dense features for
each image. The encoder is not trained, so the features are computed once and
cached. A small convolutional head is then trained on top
of the features, which takes seconds to minutes, even on a CPU.

In practice:

- **It adapts to your project.** The head learns the structures and the modality
  of your images. It is not a general-purpose object model.
- **The model is saved in the project.** Reopening the `.dida` file restores the
  trained head, so predictions are reproducible and travel with the data.
- **Only reviewed frames are used for training.** Partially annotated frames that
  are not marked reviewed are ignored.


The encoder is downloaded once, the first time you use it; no data is sent
anywhere.

!!! tip "If training is slow"
    Check the device reported under the training panel. See
    [Troubleshooting](../troubleshooting.md#gpu-training-falls-back-to-the-cpu).
