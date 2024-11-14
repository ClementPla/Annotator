import { ComponentFixture, TestBed } from '@angular/core/testing';

import { BiomarkersListComponent } from './biomarkers-list.component';

describe('BiomarkersListComponent', () => {
  let component: BiomarkersListComponent;
  let fixture: ComponentFixture<BiomarkersListComponent>;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [BiomarkersListComponent]
    })
    .compileComponents();
    
    fixture = TestBed.createComponent(BiomarkersListComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
  });

  it('should create', () => {
    expect(component).toBeTruthy();
  });
});
