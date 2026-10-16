import { inject } from '@angular/core';
import { CanActivateFn, Router, UrlTree } from '@angular/router';
import { ProjectService } from '../services/project/project.service';
import { UserService } from '../services/users/user.service';

/** A project is open. Enough for the account picker. */
export const projectOpenGuard: CanActivateFn = () => {
  if (inject(ProjectService).isOpen()) return true;
  return inject(Router).createUrlTree(['']);
};

/** A project is open and someone is logged in: annotations are per user. */
export const projectStartedGuard = async (): Promise<true | UrlTree> => {
  const router = inject(Router);
  const users = inject(UserService);
  if (!inject(ProjectService).isOpen()) return router.createUrlTree(['']);
  if (!(await users.ensureSession())) return router.createUrlTree(['/users']);
  return true;
};

/** Pages that change what every user shares, or compare users: a started
 *  project, and an admin. */
export const adminGuard: CanActivateFn = async () => {
  // `inject` only works before the first await.
  const router = inject(Router);
  const users = inject(UserService);
  const started = await projectStartedGuard();
  if (started !== true) return started;
  return users.isAdmin() ? true : router.createUrlTree(['/gallery']);
};
