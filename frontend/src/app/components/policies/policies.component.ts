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
          return "By accessing or using Phoenix Fall, you agree to these Terms of Service. Do not cheat, hack, exploit bugs, interfere with the service, or use unauthorized third-party software to gain an unfair advantage. Virtual currency, items, upgrades, and other virtual content have no cash value and cannot be exchanged for money. We may suspend or close an account that seriously or repeatedly violates these terms, subject to applicable law. The game is provided as available, without warranties beyond those required by law.";
      }
      if (this.type === 'privacy') {
          return "If you create an account, we store your email address, username, a password hash or Google account identifier, gameplay progress, virtual currency balances, purchase entitlements, and leaderboard statistics. Guest progress is stored on your device unless you sign in. We do not sell personal data. We use account and gameplay data to operate, secure, sync, and support the game. Google AdMob may collect device and advertising identifiers and ad interaction data to provide and measure ads. Google Play processes purchases and payments. You can delete your account and associated server data from your profile. Contact hello@phoenixwebsites.ai with privacy questions.";
      }
      if (this.type === 'refunds') {
          return "In-app purchases are processed by Google Play. Refund requests are handled under Google Play policies and applicable consumer law. Virtual currency and items have no cash value and cannot be exchanged for money. The Monthly Crate Pass renews through Google Play until cancelled in Google Play settings; cancelling stops future renewals. Contact Google Play for payment and refund support.";
      }
      return "Policy not found.";
  }
}
