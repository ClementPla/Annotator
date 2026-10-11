---
title: 'Didascalie: a local platform for annotating, grading, registering and inspecting biomedical image datasets'
tags:
  - image annotation
  - medical imaging
  - segmentation
  - interactive segmentation
  - image registration
  - inter-rater agreement
  - Rust
  - desktop application
authors:
  - name: Clément Playout
    orcid: 0000-0002-0978-3588
    affiliation: 1
affiliations:
  - name: Centre de recherche de l'Hôpital Maisonneuve-Rosemont, Montréal, Canada
    index: 1
date: 11 October 2026
bibliography: paper.bib
---

# Summary

Didascalie is a desktop application for annotating biomedical images, comparing
the people or models that labelled them, and registering pairs of images. A
researcher or clinician installs it like any other program, opens a project file
and starts drawing: there is no server to set up and no programming environment to
maintain, and no image leaves the computer.

The same editor is used for a single image, a video and a 3D volume, so the tools
learned on one carry over to the others. Structures are outlined with a brush, a
lasso or vector shapes, and a rough stroke can be refined automatically into the
outline of the structure underneath (\autoref{fig:editor}). Frames can also be classified, annotated with
keypoints and aligned with one another. Several annotators can work on the same
project, each in their own account, and the application measures how well they
agree. Didascalie runs on Windows, macOS and Linux; an Android tablet build offers
the manual tools with finger and pen input, and an iOS build is in progress.

![The editor: three structures segmented on an echocardiography frame, with the labels and the sequences of the project on the left.\label{fig:editor}](docs/assets/screenshots/editor.jpg)

# Statement of need

Supervised models in biomedical imaging depend on labels drawn by people with
domain knowledge: clinicians, pathologists, biologists. Three constraints shape the
software these people can use.

The images often cannot be sent to a hosted service, because institutional
data-governance and ethics rules prohibit it. The annotators are rarely engineers:
asking a clinician to deploy a container or maintain a Python environment is a real
obstacle, and in the author's experience many still annotate in presentation or
drawing software. And a single
study commonly mixes data types and tasks, such as photographs, gigapixel
microscopy, videos and volumes, to be segmented, classified or registered.

Didascalie is aimed at this situation. It is a single installed binary in which a
project is one portable file and all processing runs on the annotator's hardware,
so there is no upload path to audit. An annotator learns one tool, whatever the
data: a video is a sequence of frames and a volume a sequence of slices, both
opened in the editor used for single images, where the brush, the lasso, the
assistance, the display adjustments and the undo history behave identically. Ease
of use has been a constant constraint on the design, and the interface was shaped
with clinicians who annotate without an engineering background.

A project is also shared between people. Each annotator has an account in the
project file and labels the same images without seeing the others' work, which is
what a reader study or a double-graded dataset requires. An agreement page then
compares graders two at a time: Dice, IoU and Cohen's kappa for each label,
agreement and kappa for each classification task, and the frames where two graders
differ most (\autoref{fig:agreement}). The same mechanism serves to inspect
models. The companion library `pydidascalie` writes a model's predictions under an
account of its own, next to the annotators' work and not over it, so that several
models, or a model and its ground truth, are compared like any two graders and
browsed frame by frame.

![The agreement page: scores for a pair of graders, and the frames where they differ, drawn with what only one of them marked.\label{fig:agreement}](docs/assets/screenshots/intergrader.png)

# State of the field

CVAT [@cvat] and Label Studio [@labelstudio] are capable, actively maintained
annotation platforms. Both
are web applications: they can be self-hosted on the annotator's own machine, but
doing so means deploying and maintaining a server, a task for an engineer more than
for the clinician who annotates. Desktop tools carry other constraints. ilastik
[@berg2019ilastik] and LABKIT [@arzt2022labkit] are built to segment images, not to
curate a labelled dataset: the user scribbles on a few regions, a pixel classifier
is trained, and the result is that classifier's prediction. They work on one image
or one analysis at a time, and offer no review tracking, per-image classification
or comparison between annotators. napari [@napari] is a viewer with annotation
layers that requires the annotator to maintain a Python environment. QuPath [@bankhead2017qupath] is specialised for digital pathology. 3D
Slicer [@fedorov2012slicer] addresses clinical image computing, and dataset
labelling is not its focus. Model-based assistance, whether a prompted model such as SAM [@kirillov2023sam]
or MONAI Label [@diazpinto2024monailabel], which serves such models to clinical
viewers, assumes a GPU server or a substantial local inference stack.

Didascalie was built as a new tool, not as an extension of one of these, because
its requirements are architectural. A plugin for napari or 3D Slicer inherits the
installation and the interface of its host, which are the two obstacles for the
intended users. A project that is one file with per-annotator accounts, raster and
vector annotations sharing one document and one undo history, and an editor that
stays responsive on gigapixel images could not be added to an existing platform
without replacing its storage and rendering layers.

# Software design

**One file, no server.** A project is a SQLite database holding the images
(embedded or referenced), the annotations, the labels and the accounts. Sending a
task to a collaborator means sending a file, the format is readable from any
language, and `pydidascalie` reads and writes projects
without the application running. Referenced images are located per machine, so one
file moves between operating systems.

**Compiled core, web interface.** Image decoding, mask encoding and database access
are implemented in Rust, behind a web frontend packaged with Tauri. The frontend
gives one interface on every platform; the compiled core keeps it responsive where
a browser or an interpreted layer stalls, including on a mobile device. Masks are
composited on the GPU with WebGPU and fall back to the CPU. Very large images are served from a
resolution pyramid: the view draws the coarsest level that still oversamples the
viewport and composites native-resolution tiles over the region under inspection,
so an image too large for a browser to decode remains editable at full resolution.

**Assistance without a model.** The annotator paints roughly over a structure, and
an operator refines that stroke into the structure's outline: the stroke says where
to look, and the operator, confined to the pixels it covers, decides which of them
belong. Dynamic Otsu thresholding, flood fill and superpixel selection are
available, with optional smoothing, hole filling and a connectivity constraint.
These operators were preferred to a learned model as the default because they need
no setup, no training data and no GPU, answer at once, and give results that are
easy to predict and to correct. Display adjustments (contrast, gamma, tone curves)
can be routed into them, so that an operator reads the enhanced image the annotator
is looking at. A learned alternative, a small head trained from scribbles over
features of a frozen self-supervised encoder [@amir2021deepvit; @oquab2024dinov2;
@simeoni2025dinov3], is in development; its benefit over the operators has not yet
been evaluated.

**Registration as an annotation task.** The annotator places corresponding
keypoints on two frames, such as two visits of a patient or two modalities, and a
homography is re-estimated each time a point is placed. Overlay and checkerboard views show the
alignment while it is being built.

**The user's own model, in the user's own code.** Importing models into the
application would require a common exchange format, and export to ONNX often fails
on research architectures. Didascalie instead calls the user's Python process. An
ordinary function, which receives the image as an array and returns one mask per
label, is decorated and served from the user's script:

```python
from didascalie.com import register_seg, serve

@register_seg
def vessels(image):
    return {"vessels": my_model(image) > 0.5}

serve()
```

The function then appears in the editor and runs on the open frame or on its whole
sequence; a second kind proposes keypoint correspondences for registration.
Didascalie places no requirement on what the function does. It runs in the user's
environment, so it can call a PyTorch model with its original preprocessing and
weights, or a classical image-processing pipeline. The exchange goes both ways: the
function can ask for the masks already drawn and use them as a prompt, and what it
returns is drawn in the editor, where it can be corrected.

Mask encoding, geometry, skeletonisation, volume assembly and dataset conversion
are covered by unit tests run in continuous integration. Volume mode and the Python
functions are the most recent parts and are marked experimental in the application.

# Research impact statement

Didascalie has been used in several clinical and laboratory settings since 2024,
first under the name LabelMed.

- The training annotations of DNAi, a tool for DNA fibre analysis, were produced
  with it [@playout2026dnai].
- It was used to annotate retinal neovascularisation in high-resolution
  ultra-widefield fundus images, a task that relies on full-resolution editing of
  large images.
- It was used to create the optic disc and macula annotations behind the models of
  the fundus-odmac-toolkit [@odmac_toolkit].
- Several studies in preparation rely on it for their annotations, mostly in
  ophthalmology, which requires multimodal imaging and high-resolution editing.

Source and installers are available at <https://github.com/ClementPla/Didascalie> under the BSD-3-Clause licence, with
user documentation at <https://didascalie.readthedocs.io>.

# AI usage disclosure

Development began in 2024, without generative AI.
<!-- TODO: check the starting date and the model versions below. -->
Since 2026, Claude Code (Anthropic), with the Claude Sonnet and Opus models
available at the time, up to Claude Opus 5.5, has been used to implement features, write tests, fix defects and draft the documentation, from
requirements and design decisions set by the author. It also assisted in writing this
manuscript and revising its language; the author determined its content, structure
and claims. The author chose the architecture and the project format,
reviewed the generated code and text, and edited or rejected them where needed.
Generated code was validated by the unit tests and continuous integration of the
repository, and by use of the application on real data, by the author and by the
clinicians who annotate with it. The author takes responsibility for all of the
software and of this paper.

# Acknowledgements

The author thanks the clinicians and researchers from Maisonneuve-Rosemont Hospital
and Polytechnique Montréal whose sustained feedback shaped the annotation workflow,
as well as the Line-Chevrette funding (FRTIAO) that supported the development of the
application.

# References
