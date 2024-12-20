

export interface SegLabel {
    label: string;
    color: string;
    isVisible: boolean;
    shades: string[] | null;


}

export interface SegInstance{
    label: SegLabel;
    instance: number;
    shade: string;
}

export interface ClassLabel {
    label: string;
    isExclusive: boolean;
}
export interface Thumbnail{
    name: Promise<string>;
    thumbnailPath: Promise<string>;
}

export interface Point2D {
    x: number;
    y: number;
}

export interface Rect {
    x: number;
    y: number;
    width: number;
    height: number;
}


export interface Viewbox{
    xmin: number;
    ymin: number;
    xmax: number;
    ymax: number;
}

export interface UndoRedoCanvasElement{
    data: Blob | Blob[];
    index: number;
}

export interface ProjectConfig{
    project_name: string,
    input_dir: string,
    output_dir: string,
    is_segmentation: boolean,
    is_classification: boolean,
    is_instance_segmentation: boolean,
    segmentation_classes: null | string[],
    classification_classes: null | string[],

}