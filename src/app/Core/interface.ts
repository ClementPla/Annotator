

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


export interface UndoRedoCanvasElement{
    data: Promise<Blob>;
    index: number;
}