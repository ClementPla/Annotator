import { ComponentFixture, TestBed } from '@angular/core/testing';

import { ListImagesComponent } from './list-images.component';

describe('ListImagesComponent', () => {
  let component: ListImagesComponent;
  let fixture: ComponentFixture<ListImagesComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [ListImagesComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(ListImagesComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
