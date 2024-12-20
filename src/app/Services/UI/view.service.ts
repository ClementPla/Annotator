import { Injectable } from '@angular/core';
import { Router } from '@angular/router';

@Injectable({
  providedIn: 'root'
})
export class ViewService {


  isLoading: boolean = false;
  loadingStatus: string = '';
  thumbnailsSize: number = 128;


  constructor(private router: Router) { }

  setLoading(status: boolean, message: string) {
    this.isLoading = status;
    this.loadingStatus = message;
  }

  endLoading() {
    this.isLoading = false;
    this.loadingStatus = '';
  }

  navigateToGallery() {
    this.router.navigate(['/gallery']);
  }

  navigateToEditor() {
    if (this.router.url === '/editor') {
      return;
    }
    this.router.navigate(['/editor']);
  }


  
}