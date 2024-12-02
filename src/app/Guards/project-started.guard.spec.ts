import { TestBed } from '@angular/core/testing';
import { CanActivateFn } from '@angular/router';

import { projectStartedGuard } from './project-started.guard';

describe('projectStartedGuard', () => {
  const executeGuard: CanActivateFn = (...guardParameters) => 
      TestBed.runInInjectionContext(() => projectStartedGuard(...guardParameters));

  beforeEach(() => {
    TestBed.configureTestingModule({});
  });

  it('should be created', () => {
    expect(executeGuard).toBeTruthy();
  });
});
