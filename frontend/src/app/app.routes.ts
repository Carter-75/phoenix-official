import { Routes } from '@angular/router';
import { MainMenuComponent } from './components/main-menu/main-menu.component';
import { ShopComponent } from './pages/shop/shop.component';
import { LoginComponent } from './pages/login/login.component';
import { GameComponent } from './pages/game/game.component';
import { ProfileComponent } from './pages/profile/profile.component';
import { LeaderboardComponent } from './pages/leaderboard/leaderboard.component';
import { CodexComponent } from './pages/codex/codex.component';

export const routes: Routes = [
  { path: '', redirectTo: 'menu', pathMatch: 'full' },
  { path: 'menu', component: MainMenuComponent },
  { path: 'shop', component: ShopComponent },
  { path: 'login', component: LoginComponent },
  { path: 'game', component: GameComponent },
  { path: 'profile', component: ProfileComponent },
  { path: 'leaderboard', component: LeaderboardComponent },
  { path: 'codex', component: CodexComponent },
  { path: 'crate_opening', loadComponent: () => import('./components/crate-opening/crate-opening.component').then(m => m.CrateOpeningComponent) }
];
