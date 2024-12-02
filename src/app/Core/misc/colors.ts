import { flavors, version, flavorEntries, FlavorName} from "@catppuccin/palette";



export function getDefaultColor(n: number){

    n = n % 32

    let color = "#ffffff"
    flavorEntries.map(([_, flavor]) => {
        if(flavor.name==='Latte'){
            
            flavor.colorEntries.map(([colorName, { hex, rgb, accent }], index) => {
                if(index===n){
                    color = hex
                }
            })
        }
        })
    return color

}