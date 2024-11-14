import { Injectable } from '@angular/core';

@Injectable({
  providedIn: 'root'
})
export class ViewService {

  isLoading: boolean = false;
  loadingStatus: string = '';

  constructor() { }

  setLoading(status: boolean, message: string) {
    this.isLoading = status;
    this.loadingStatus = message;
  }

  endLoading() {
    this.isLoading = false;
    this.loadingStatus = '';
  }
}
