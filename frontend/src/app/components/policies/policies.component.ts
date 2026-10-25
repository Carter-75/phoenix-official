import { Component, inject, OnInit } from '@angular/core';
import { CommonModule } from '@angular/common';
import { ActivatedRoute, Router } from '@angular/router';

@Component({
  selector: 'app-policies',
  standalone: true,
  imports: [CommonModule],
  template: `
    <div class="min-h-screen bg-black text-white p-8 flex flex-col items-center custom-scrollbar overflow-y-auto">
       <div class="w-full max-w-3xl flex flex-col mt-12 bg-white/5 border border-white/10 rounded-3xl p-8 md:p-12 shadow-2xl">
           <button (click)="goBack()" class="self-start text-white/50 hover:text-white transition flex items-center gap-2 mb-8">
              <span class="text-2xl">←</span> Return to Game
           </button>
           
           <h1 class="text-4xl md:text-5xl font-black mb-8 text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-blue-600">
               {{ getTitle() }}
           </h1>
           
           <div class="text-white/80 leading-relaxed space-y-6 text-lg">
               {{ getContent() }}
           </div>
           
           <div class="mt-12 pt-8 border-t border-white/10 flex justify-center gap-6">
               <button (click)="navigate('tos')" class="text-sm font-bold hover:underline transition" [class.text-cyan-400]="type === 'tos'">Terms of Service</button>
               <button (click)="navigate('privacy')" class="text-sm font-bold hover:underline transition" [class.text-cyan-400]="type === 'privacy'">Privacy Policy</button>
               <button (click)="navigate('refunds')" class="text-sm font-bold hover:underline transition" [class.text-cyan-400]="type === 'refunds'">Refund Policy</button>
           </div>
       </div>
    </div>
  `
})
export class PoliciesComponent implements OnInit {
  route = inject(ActivatedRoute);
  router = inject(Router);
  
  type: string = 'tos';

  ngOnInit() {
      this.route.paramMap.subscribe(params => {
          this.type = params.get('type') || 'tos';
      });
  }

  navigate(newType: string) {
      this.router.navigate(['/policies', newType]);
  }

  goBack() {
      this.router.navigate(['/']);
  }

  getTitle(): string {
      if (this.type === 'tos') return 'Terms of Service';
      if (this.type === 'privacy') return 'Privacy Policy';
      if (this.type === 'refunds') return 'Refund Policy';
      return 'Legal Policy';
  }

  getContent(): string {
      if (this.type === 'tos') {
          return "By accessing or using Phoenix Fall, you agree to be bound by these Terms of Service. Phoenix Fall is provided 'as-is' without warranties of any kind. You may not cheat, hack, exploit bugs, or use unauthorized third-party software. All virtual items, currencies, and accounts remain the property of the developer. We reserve the right to ban accounts without notice for violating these terms. If your account is banned, you will permanently lose access to all purchased virtual items and currency, and no refunds will be provided. We are not responsible for any emotional distress caused by our highly addictive gameplay loop.";
      }
      if (this.type === 'privacy') {
          return "Phoenix Fall respects your privacy. When you register, we securely store your email, username, and encrypted password (or Google OAuth identifier), along with your gameplay progress and virtual currency balances. We DO NOT sell your personal data to third parties. We use the Google Ads network to serve automated, dynamic advertisements, which may use device identifiers and gameplay context for targeted ad delivery. We also collect basic gameplay analytics to improve the game. You may permanently delete your account and all associated data at any time from your profile.";
      }
      if (this.type === 'refunds') {
          return "All in-app purchases made in Phoenix Fall are processed securely through the Google Play Store. ALL SALES ARE FINAL. Virtual currency (Gems) and premium upgrades hold no real-world fiat value and cannot be exchanged for cash. We do not offer direct refunds for accidental purchases, account bans, or buyer's remorse. All refund requests must be directed to and handled by Google Play Customer Support in accordance with their standard refund policies.";
      }
      return "Policy not found.";
  }
}
