import { Injectable, inject } from '@angular/core';
import { HttpClient } from '@angular/common/http';
import { firstValueFrom } from 'rxjs';
import { Capacitor } from '@capacitor/core';
import { LocalNotifications } from '@capacitor/local-notifications';
import { App } from '@capacitor/app';
import { environment } from '../../environments/environment';
import { AudioService } from './audio.service';
import { AuthService } from './auth.service';

@Injectable({
  providedIn: 'root'
})
export class NotificationService {
  private http = inject(HttpClient);
  private audio = inject(AudioService);
  private auth = inject(AuthService);

  async setupNotifications(onTriggerCrazyDeal: (expiresAt?: number) => void) {
      if (Capacitor.isNativePlatform()) {
          const permStatus = await LocalNotifications.requestPermissions();
          if (permStatus.display === 'granted') {
              await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }, { id: 3 }] });
              
              LocalNotifications.addListener('localNotificationActionPerformed', (action) => {
                  if (action.notification.extra && action.notification.extra.crazyDealExpiresAt) {
                      onTriggerCrazyDeal(action.notification.extra.crazyDealExpiresAt);
                  }
              });

              App.addListener('appStateChange', async ({ isActive }) => {
                  if (!isActive) {
                      this.audio.pauseAudioForAd();
                      const notificationsToSchedule: any[] = [
                          {
                              title: "We miss you!",
                              body: "Come back and defeat some enemies. Your Phoenix needs you!",
                              id: 1,
                              schedule: { at: new Date(Date.now() + 1000 * 60 * 60 * 24) }
                          },
                          {
                              title: "A Deal Awaits! 💎",
                              body: "A massive Gem deal is waiting for you in the shop.",
                              id: 2,
                              schedule: { at: new Date(Date.now() + 1000 * 60 * 60 * 48) }
                          }
                      ];

                      if (Math.random() < 0.3) {
                          const triggerTime = Date.now() + 1000 * 60 * 60 * 72;
                          const expiryTime = triggerTime + 1000 * 60 * 5;
                          
                          notificationsToSchedule.push({
                              title: "Hey! Don't miss this crazy once in a lifetime deal!",
                              body: "250 Gems for $9.99. Offer expires 5 minutes from this notification!",
                              id: 3,
                              schedule: { at: new Date(triggerTime) },
                              extra: { crazyDealExpiresAt: expiryTime }
                          });
                      }

                      await LocalNotifications.schedule({ notifications: notificationsToSchedule });
                  } else {
                      this.audio.resumeAudioAfterAd();
                      await LocalNotifications.cancel({ notifications: [{ id: 1 }, { id: 2 }, { id: 3 }] });
                  }
              });
          }
      } else if ('serviceWorker' in navigator && 'PushManager' in window) {
          try {
              const registration = await navigator.serviceWorker.register('/service-worker.js');
              
              const res = await firstValueFrom(this.http.get<any>(environment.apiUrl + '/notifications/vapidPublicKey'));
              const vapidPublicKey = res.publicKey;
              
              if (!vapidPublicKey) return;

              const permission = await Notification.requestPermission();
              if (permission !== 'granted') return;

              const subscription = await registration.pushManager.subscribe({
                  userVisibleOnly: true,
                  applicationServerKey: this.urlBase64ToUint8Array(vapidPublicKey)
              });

              if (this.auth.currentUser() && !this.auth.currentUser()?.isTemp) {
                  await firstValueFrom(this.http.post(environment.apiUrl + '/notifications/subscribe', subscription));
              }
          } catch (e) {
              console.log('Web Push error', e);
          }
      }
  }

  private urlBase64ToUint8Array(base64String: string) {
      const padding = '='.repeat((4 - base64String.length % 4) % 4);
      const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
      const rawData = window.atob(base64);
      const outputArray = new Uint8Array(rawData.length);
      for (let i = 0; i < rawData.length; ++i) {
          outputArray[i] = rawData.charCodeAt(i);
      }
      return outputArray;
  }
}
