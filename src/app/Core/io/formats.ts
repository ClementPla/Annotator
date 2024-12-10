import { invoke } from "@tauri-apps/api/core";
import { XMLBuilder } from "fast-xml-parser";

export interface LabelFormat {
    masksName: string[];
    masks: Blob[];
    labels: string[];
    colors: string[];
}
