

export class LabelFormat {
    masksName: string[] = [];
    masks: string[] = [];
    labels: string[] = [];
    colors: string[] = [];
}

export class ImageFormat {
    src: string = '';
    src_preprocessing = '';
}

export class LoadSaveFormat {
    image: ImageFormat;
    label: LabelFormat;
}