import { AfterViewInit, ChangeDetectorRef, Component, HostListener, OnInit } from '@angular/core';
import { ToolbarModule } from 'primeng/toolbar';
import { ViewService } from './Services/UI/view.service';
import { LoadingComponent } from "./Components/Interface/loading/loading.component";
import { RouterOutlet } from '@angular/router';
import { NgIf } from '@angular/common';
import { ProjectService } from './Services/Project/project.service';
import { Button } from 'primeng/button';
import { RouterModule } from '@angular/router';
import { environment } from '../environments/environment';
import { LabelsService } from './Services/Project/labels.service';
import { TestingComponent } from "./Components/Core/testing/testing.component";
import { DrawingService } from './Services/UI/drawing.service';
import { PrimeNGConfig } from 'primeng/api';

import { CLIService } from './Services/cli.service';


@Component({
  selector: 'app-root',
  standalone: true,
  imports: [ToolbarModule, LoadingComponent, NgIf, RouterOutlet, Button, RouterModule, TestingComponent],
  templateUrl: './app.component.html',
  styleUrl: './app.component.scss'
})
export class AppComponent implements AfterViewInit, OnInit{
  title = 'Client';

  constructor(public viewService: ViewService, 
    public projectService: ProjectService,
    public drawService: DrawingService, 
    private labelService: LabelsService,
    private primengConfig: PrimeNGConfig,
    private cli: CLIService,
    private cdr: ChangeDetectorRef
    ){}

  ngAfterViewInit(): void {
    // this.debug();
    
    
  }

  ngOnInit(): void {
    this.primengConfig.ripple = true;
    this.cli.createCLIHooks();

    this.cli.commandProcessed.subscribe((value) => {
      if(value){
        this.cdr.detectChanges();
      }
    });
  }

  async debug(){


    this.labelService.addSegLabel( { label: "Foreground", color: "#209fb5", isVisible: true, shades: null});
    this.labelService.addSegLabel( { label: "Example1/Class 1", color: "#df8e1d" , isVisible: true, shades: null });
    this.labelService.addSegLabel( { label: "Example1/Class 2", color: "#8839ef" , isVisible: true, shades: null });
    this.labelService.addSegLabel( { label: "Example2/Class 3", color: "#d20f39" , isVisible: true, shades: null });
    let isStarted$ = this.projectService.startProject(environment.defaultRegex, true);
    this.projectService.isSegmentation = true;
    isStarted$.then(() => {
      this.projectService.openEditor(0);
      this.drawService.useProcessing = false;
      // this.drawService.autoPostProcess = true;
      // this.drawService.postProcessOption = "MedSAM"



    });
    
    
  }
}
