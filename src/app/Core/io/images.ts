import { invoke } from '@tauri-apps/api/core';


export function loadImageFile(filepath: string): Promise<string> {
    return invoke<ArrayBuffer>('load_image_as_base64', { filepath: filepath })
        .then((value) => {
            return new Promise<string>((resolve, reject) => {
                const blob = new Blob([value], { type: 'image/png' });
                const reader = new FileReader();
                reader.onloadend = () => {
                    resolve(reader.result as string);
                };
                reader.onerror = (error) => {
                    reject(error);
                };
                reader.readAsDataURL(blob);
            });
        });
}