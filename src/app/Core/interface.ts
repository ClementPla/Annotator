

export interface SegLabel {
    label: string;
    color: string;
    isVisible: boolean;


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