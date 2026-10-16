# Frame registration

Registration aligns two frames of a sequence. You place corresponding keypoints on
both, and a homography is estimated from them.

## Opening it

Click **Pair keypoints** (:material-map:) on a sequence in the gallery, or the map
button in the top toolbar to work on the current sequence.

## The workflow

1. In the sidebar, pick a **Reference** and a **Moving** frame from the sequence.
2. Click a point on one frame, then its counterpart on the other. You can start on
   either side. ++esc++ cancels a point waiting for its counterpart.
3. The homography updates as you go. It needs at least four correspondences, and
   more improve the fit. The sidebar reports the fit error (RMSE and maximum, in
   pixels).

Drag a placed point to move it. Once a fit exists, the expected position of the
counterpart is shown while you place a point.

Each reference/moving pair is saved as a **case**, listed at the top of the
sidebar. A sequence can hold several, for instance one per acquisition. **+**
starts a new case; switching case saves the current one first.

## Checking the result

Check the alignment visually. The numeric fit alone can be misleading.

- **Side by side** shows both frames. **Sync pan/zoom** moves them together,
  **Show shadow cursor** marks where the pointer falls on the other frame, and
  **Show warped** (++tab++) draws the moving frame warped onto the reference.
- **Overlay** blends the warped moving frame over the reference, with an opacity
  slider.
- **Checkerboard** alternates tiles from each frame, so misaligned edges break at
  the tile borders. The tile size is adjustable.

On desktop, **Composite view in new window** opens the overlay and checkerboard in
a separate window that you can keep on top of others.

When the estimated transform is degenerate (a near-singular homography), the
warped image is meaningless. The view hides it and shows a warning.

## Keys

| Action | Keys |
| --- | --- |
| Show or hide the warped frame (side by side) | ++tab++ |
| Cancel the pending point | ++esc++ |
| Save | ++ctrl+s++ |
| Hide or show the sidebar | ++b++ |
| Next / previous sequence | ++arrow-right++ / ++arrow-left++ |

## Suggested correspondences

A Python function of yours can propose keypoint pairs, so that you do not place
them all by hand. See
[Your own Python functions](python-functions.md#keypoint-functions).

<!-- SCREENSHOT: side-by-side panes with a few numbered correspondences placed. -->
