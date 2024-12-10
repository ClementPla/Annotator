import { Point2D } from "../interface";
import StampMaker from "./stampmaker";

const stampMaker = new StampMaker()

function distanceBetween(point1: Point2D, point2: Point2D): number{
    return Math.sqrt(Math.pow(point1.x - point2.x, 2) + Math.pow(point1.y - point2.y, 2));
}

function angleBetween(point1: Point2D, point2: Point2D): number{
    return Math.atan2(point2.y - point1.y, point2.x - point1.x);
}


export function drawLine(context: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, from: Point2D, to: Point2D, size: number, color: string){

    const halfSize = (size - (size % 2)) / 2
    const stamp = stampMaker.make(size, color)!

    if (from.x === to.x && from.y === to.y) {

        const x = from.x - halfSize
  
        const y = from.y - halfSize
  
        context.drawImage(stamp, Math.round(x), Math.round(y), size, size)
  
        return
  
      }
  
      const dist = distanceBetween(from, to)
  
      const angle = angleBetween(from, to)
  
      for (let i = 0; i < dist; i += 1) {
  
        const x = from.x + (Math.sin(angle) * i) - halfSize
  
        const y = from.y + (Math.cos(angle) * i) - halfSize
        context.drawImage(stamp, Math.round(x), Math.round(y), size, size)
  
  
      }

}