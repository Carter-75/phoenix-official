import { Injectable, inject, signal } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { Observable, tap, catchError, of } from 'rxjs';
import { environment } from '../../environments/environment';

@Injectable({
  providedIn: 'root'
})
export class ApiService {
  private http = inject(HttpClient);
  public currentUser = signal<any>(null);

  // Dynamic API URL mapping
  private get apiUrl(): string {
    return environment.apiUrl;
  }

  getData<T>(endpoint: string): Observable<T> {
    return this.http.get<T>(`${this.apiUrl}/${endpoint}`);
  }

  postData<T>(endpoint: string, body: any): Observable<T> {
    return this.http.post<T>(`${this.apiUrl}/${endpoint}`, body);
  }

  // --- Auth Methods ---
  login(credentials: any): Observable<any> {
    return this.http.post<any>(`${this.apiUrl}/auth/login`, credentials).pipe(
      tap(user => this.currentUser.set(user))
    );
  }

  // Redirect-based Google Login
  loginWithGoogle(): void {
    window.location.href = `${this.apiUrl}/auth/google`;
  }

  checkStatus(): Observable<any> {
    return this.http.get<any>(`${this.apiUrl}/auth/user`).pipe(
      tap({
        next: user => this.currentUser.set(user),
        error: () => this.currentUser.set(null)
      }),
      catchError(err => of(null))
    );
  }

  logout(): void {
    localStorage.removeItem('auth_token');
    this.currentUser.set(null);
  }
}
