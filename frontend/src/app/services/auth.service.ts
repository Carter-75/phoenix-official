import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of, map } from 'rxjs';
import { environment } from '../../environments/environment';
import { Capacitor } from '@capacitor/core';
import { GoogleAuth } from '@codetrix-studio/capacitor-google-auth';

export interface User {
  _id: string;
  username: string;
  email?: string;
  level: number;
  xp: number;
  coins: number;
  gems: number;
  unlockedWorlds: number[];
  trophies: string[];
  worldUpgrades?: Record<number, any>;
  isTemp?: boolean;
  acceptedLegalPolicies?: boolean;
  hasRemoveAds?: boolean;
  reviveTokens?: number;
  boostExpiresAt?: number;
  boostMultiplier?: number;
  hasActiveSub?: boolean;
  isSubscribed?: boolean;
  [key: string]: any;
}

export interface LoginCredentials {
  email?: string;
  username?: string;
  password?: string;
}

export interface RegisterCredentials {
  email: string;
  username: string;
  password?: string;
  acceptedLegalPolicies?: boolean;
}

@Injectable({
  providedIn: 'root'
})
export class AuthService {
  private http = inject(HttpClient);
  public currentUser = signal<User | null>(null);

  constructor() {
    if (Capacitor.isNativePlatform()) {
      // Web client id: Android requestIdToken needs the server (web) client.
      GoogleAuth.initialize({
        clientId: '108585498879-v35d0d196d4djglodbbjok452pr1e04r.apps.googleusercontent.com',
        scopes: ['profile', 'email'],
        grantOfflineAccess: true
      });
    }
  }

  private apiUrl = environment.apiUrl + '/auth';

  login(credentials: LoginCredentials): Observable<User> {
    // The API returns { user, token }. Store the token or every later
    // authenticated call fails (audit bug 5).
    return this.http.post<{user: User, token: string}>(`${this.apiUrl}/login`, credentials).pipe(
      tap(res => {
        if (res.token) localStorage.setItem('auth_token', res.token);
        this.currentUser.set(res.user);
      }),
      map(res => res.user)
    );
  }

  sync(data: Partial<User>): Observable<User> {
    return this.http.post<User>(`${this.apiUrl}/sync`, data).pipe(
      tap(user => this.currentUser.set(user))
    );
  }

  acceptPolicies(): Observable<any> {
    return this.http.post(`${this.apiUrl}/accept-policies`, {}).pipe(
      tap(() => {
        const user = this.currentUser();
        if (user) {
          this.currentUser.set({ ...user, acceptedLegalPolicies: true });
        }
      }),
      catchError(err => of(null))
    );
  }

  deleteAccount(): Observable<any> {
    return this.http.delete(`${this.apiUrl}/user`).pipe(
      tap(() => {
        localStorage.removeItem('auth_token');
        this.currentUser.set(null);
      }),
      catchError(err => of(null))
    );
  }

  register(credentials: RegisterCredentials): Observable<User> {
    return this.http.post<{user: User, token: string}>(`${this.apiUrl}/register`, credentials).pipe(
      tap(res => {
        if (res.token) localStorage.setItem('auth_token', res.token);
        this.currentUser.set(res.user);
      }),
      map(res => res.user)
    );
  }

  completeSignup(username: string): Observable<User> {
    return this.http.post<{user: User, token: string}>(`${this.apiUrl}/complete-signup`, { username }).pipe(
      tap(res => {
        if (res.token) localStorage.setItem('auth_token', res.token);
        this.currentUser.set(res.user);
      }),
      map(res => res.user)
    );
  }

  async loginWithGoogle(): Promise<User | void> {
    if (Capacitor.isNativePlatform()) {
      try {
        const googleUser = await GoogleAuth.signIn();
        const idToken = googleUser.authentication.idToken;
        
        const req$ = this.http.post<{user: User, token: string}>(`${this.apiUrl}/google/native`, { idToken }).pipe(
          tap(res => {
            if (res.token) localStorage.setItem('auth_token', res.token);
            this.currentUser.set(res.user);
          }),
          map(res => res.user)
        );
        return await import('rxjs').then(m => m.firstValueFrom(req$));
      } catch (err) {
        console.error('Google Sign In Error:', err);
        throw err;
      }
    } else {
      window.location.href = `${this.apiUrl}/google`;
    }
  }

  checkStatus(): Observable<User | null> {
    const token = localStorage.getItem('auth_token');
    if (!token) {
      this.currentUser.set(null);
      return of(null);
    }
    
    return this.http.get<User>(`${this.apiUrl}/user`).pipe(
      tap({
        next: user => this.currentUser.set(user),
        error: () => {
           localStorage.removeItem('auth_token');
           this.currentUser.set(null);
        }
      }),
      catchError(err => of(null))
    );
  }

  logout(): void {
    this.http.get(`${this.apiUrl}/logout`).pipe(
      catchError(err => of(null))
    ).subscribe(() => {
      localStorage.removeItem('auth_token');
      this.currentUser.set(null);
    });
  }
}
