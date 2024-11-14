import { XMLParser, XMLBuilder, XMLValidator } from "fast-xml-parser";

import { LoadSaveFormat } from "./customFormat";


export class SaveAndLoad {
    xmlParser: XMLParser;
    xmlBuilder: XMLBuilder;
    xmlValidator: XMLValidator;
    constructor() {

        this.xmlBuilder = new XMLBuilder();
        this.xmlParser = new XMLParser();
        this.xmlValidator = new XMLValidator();

    }
    public saveToXML(data: LoadSaveFormat, fileName: string): void {
        const xmlContent = this.xmlBuilder.build(data);
        const blob = new Blob([xmlContent], { type: 'text/xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = fileName;
        a.click();
        URL.revokeObjectURL(url);
    }
    public loadFromXML(file: File): any {
        const reader = new FileReader();
        reader.readAsText(file);
        reader.onload = () => {
            const xml = reader.result as string;
            const data = new XMLParser().parse(xml) as SaveAndLoad;

            return data;
        }
    }
}