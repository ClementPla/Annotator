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
date: 13 October 2026
bibliography: paper.bib
---

# Summary

Didascalie is a desktop application for annotating biomedical images, comparing
the people or models that labelled them, and registering pairs of images. A
researcher or clinician installs it like any other program, opens a project file
and starts drawing: there is no server to set up and no programming environment to
maintain. Importantly, no image leaves the computer.

The same editor and its tools are used for a single image, a video and a 3D volume. Structures are outlined with a brush, a lasso or vector shapes, and a rough stroke can be refined automatically into the outline of the structure underneath (\autoref{fig:editor}). Frames can also be classified, annotated with
keypoints and registered with one another. Several annotators can work on the same
project, each in their own account, and the application measures how well they
agree. 
Didascalie runs on Windows, macOS and Linux; an Android tablet build offers
touchscreen support.

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
study commonly mixes data types and tasks, such as multimodal images, gigapixel
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
models, or a model and its ground truth, are compared like any two graders.

# State of the field

CVAT [@cvat] and Label Studio [@labelstudio] are capable, actively maintained
annotation platforms, but both are web applications. Running either locally
means operating a server, either a Docker Compose stack (CVAT) or a Python
package served to a browser (Label Studio). That is a modest task for an
engineer but an obstacle for a clinician annotating on a hospital workstation.
Among desktop tools, ilastik [@berg2019ilastik] and LABKIT [@arzt2022labkit]
centre on interactive segmentation. The user scribbles on a few regions and
trains a pixel classifier, and the classifier's output, optionally corrected,
becomes the segmentation. Neither tracks review status, records per-image
classification labels or compares annotators. napari [@napari] is a general
n-dimensional viewer with annotation layers, available as a standalone
installer, but dataset-level curation is left to plugins or scripts. QuPath
[@bankhead2017qupath] is specialised for digital pathology. 3D Slicer
[@fedorov2012slicer] is a general clinical image-computing platform whose
segmentation tools work on one volume at a time, without dataset-level review
or multi-annotator tracking. Desktop labelling tools descended from LabelMe
[@Russell2008LabelMe], notably X-AnyLabeling [@X-AnyLabeling], come closest to curating a
dataset offline. They include local inference with lightweight Segment Anything
variants [@kirillov2023sam]. However, they target general computer-vision
formats and tasks, and they do not track review status or compare annotators.
Model-assisted labelling for clinical viewers, as provided by MONAI Label
[@diazpinto2024monailabel], relies on a separate inference server.

Didascalie is a new tool rather than an extension of an existing one because
its requirements concern architecture, not features. A plugin for napari or
3D Slicer inherits its host's interface, which is a general-purpose viewer that
exposes far more than an annotation task needs. It also inherits the host's
distribution: a Python runtime and a plugin system that the annotator must keep
working across updates. Extending a LabelMe-style tool such as X-AnyLabeling
avoids the first problem but not the second, and its storage of one annotation
file per image does not fit Didascalie's design. Didascalie keeps a whole
project in a single file with per-annotator accounts. Raster and vector
annotations share one document and one undo history, and the editor stays
responsive on gigapixel images. Adding these to any of the platforms above
would mean replacing its storage and rendering layers, which amounts to
writing a new application inside an existing one.

# Software design

## Project format

A Didascalie project is a single SQLite database. It stores the annotations,
the label definitions and the annotator accounts, and it either embeds the
images or references them on disk. Each machine resolves referenced paths
separately, so the same project opens on Windows, macOS and Linux. Sharing a
task with a collaborator means sending this file. SQLite can be read from
almost any language, and the `pydidascalie` package reads and writes projects
from Python without the application running.

## Architecture

The application is built with Tauri. A Rust core handles image decoding, mask
encoding and database access, and a web frontend provides the interface, so the
interface is the same on every platform. Doing this work in compiled code rather
than in the browser or an interpreted language keeps editing responsive on large
images, including on mobile devices. Masks are composited on the GPU through
WebGPU, with a CPU fallback where WebGPU is unavailable.

Images too large for a browser to decode are stored as a resolution pyramid.
The viewer draws the lowest-resolution level that still has more pixels than
the screen area it fills, and loads full-resolution tiles only for the region
being inspected. Editing always happens at the image's native resolution.

## Annotation assistance

Instead of tracing a structure's outline, the annotator can paint a rough
stroke over it. An operator then decides which pixels under the stroke belong
to the structure. Three operators are available: Otsu thresholding computed
within the stroke, flood fill, and superpixel selection. Their output can be
smoothed, have its holes filled, or be constrained to a single connected
region. Contrast, gamma and tone-curve adjustments can be applied before the
operator runs, so it sees the same enhanced image as the annotator.

These operators are the default because they work
immediately on a CPU without training data. Their behaviour is also
predictable: when one gives a poor result, the annotator can usually see why
and fix it by hand. A learned option is in development. It trains a small
classifier on the annotator's scribbles, using features from a frozen
self-supervised encoder [@amir2021deepvit; @oquab2024dinov2;
@simeoni2025dinov3]. Whether it improves on the operators has not yet been
measured.

## Registration

Registration between two images is done by placing pairs of keypoints; Didascalie re-estimates a homography after each new point.
Overlay and checkerboard views show the current alignment as points are added.

## Running user models

Importing models into the application would require a shared format such as
ONNX, and research architectures often fail to export to it. Didascalie instead
calls a Python process that the user runs. The user writes a function that
takes the image as an array and returns one mask per label, adds a decorator,
and runs the script:

```python
from didascalie.com import register_seg, serve

@register_seg
def vessels(image):
    return {"vessels": my_model(image) > 0.5}

serve()
```

The function then appears in the editor and runs on the open frame or on its whole
sequence; a second kind proposes keypoint correspondences for registration.
Didascalie places no requirement on what the function does and it runs in the user's
own Python environment.


# Research impact statement

Didascalie has been used in several clinical and laboratory settings since 2024,
first under the name LabelMed.

- The training annotations of DNAi, a tool for DNA fibre analysis, were produced
  with it [@playout2026dnai].
- It was used to annotate retinal neovascularisation in high-resolution
  ultra-widefield fundus images, a task that relies on full-resolution editing of
  large images and required to register angiography with regular fundus.
- It was used to create the optic disc and macula annotations behind the models of
  the fundus-odmac-toolkit [@odmac_toolkit].
- Several studies in preparation rely on it for their annotations, mostly in
  ophthalmology, which requires multimodal imaging and high-resolution editing.

Source and installers are available at <https://github.com/ClementPla/Didascalie> under the BSD-3-Clause licence, with
user documentation at <https://didascalie.readthedocs.io>.

# AI usage disclosure

Development began in 2024, without generative AI.
Since 2026, Claude Code (Anthropic), with the Claude Sonnet and Opus models
available at the time, up to Claude Opus 5.5, has been used to implement features, write tests, fix defects and draft the documentation, from
requirements and design decisions set by the author. It also assisted in writing this
manuscript and revising its language. The author reviewed the generated code and text, and edited or rejected them where needed.
In addiition, generated code was validated by the unit tests and continuous integration of the
repository, and by use of the application on real data, by the author and by the
clinicians who annotate with it. The author takes responsibility for all of the
software and of this paper.

# Acknowledgements

The author thanks the clinicians and researchers from Maisonneuve-Rosemont Hospital
and Polytechnique Montréal whose sustained feedback shaped the annotation workflow,
as well as the Line-Chevrette funding (FRTIAO) that supported the development of the
application.

# References
