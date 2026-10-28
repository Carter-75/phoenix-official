import { Component, HostListener } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { ParticleBgComponent } from './components/particle-bg/particle-bg.component';
import { AdBubbleComponent } from './components/ad-bubble/ad-bubble.component';
import { GameStateService } from './services/game-state.service';
import { AuthService } from './services/auth.service';

@Component({
  selector: 'app-root',
  standalone: true,
  imports: [RouterOutlet, ParticleBgComponent, AdBubbleComponent],
  template: `
    <app-particle-bg></app-particle-bg>
    <app-ad-bubble></app-ad-bubble>
    
    <div class="absolute inset-0 z-10 w-full h-full min-h-screen">
      <router-outlet></router-outlet>

      <!-- No entry-point policy gate (Fix Round 1, Part 5): the
           agreement used to block the whole game on entry for guests
           and signed-in users alike. Consent now lives only inside
           the sign-up flow (the login component presents it before
           an account is created and records it through the existing
           accept-policies endpoint). Guests who never sign up play
           without ever seeing it. The policy documents themselves
           stay readable from the profile page and the sign-up form. -->

    </div>
  `,
})
export class App {
  constructor(public gameState: GameStateService, private auth: AuthService) {
      const urlParams = new URLSearchParams(window.location.search);
      const token = urlParams.get('token');
      if (token) {
          localStorage.setItem('auth_token', token);
          const mode = urlParams.get('mode');
          window.history.replaceState({}, document.title, window.location.pathname + (mode ? `?mode=${mode}` : ''));
      }

      const isPendingSignup = urlParams.get('mode') === 'set-username';
      if (!isPendingSignup) {
          // A pending-signup token is not a user token: /auth/user would 401
          // and the error handler would delete the token before the username
          // step can use it. Skip the session check in that flow.
          this.auth.checkStatus().subscribe(user => {
              if (user) {
                  if (user.isTemp) {
                      this.gameState.activeScreen.set('login');
                  } else {
                      this.gameState.syncWithUser(user);
                  }
              }
          });
      }

      if (isPendingSignup) {
          this.gameState.activeScreen.set('login');
      }
  }

  @HostListener('document:click', ['$event'])
  onDocumentClick(event: MouseEvent) {
      const target = event.target as HTMLElement;
      if (target.closest('button')) {
          this.gameState.audio.playSFX('click');
      }
  }
}
