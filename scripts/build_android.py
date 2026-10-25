import os
import subprocess
import sys
import shutil

def run_cmd(cmd, cwd=None):
    print(f"\n> Running: {cmd}")
    result = subprocess.run(cmd, cwd=cwd, shell=True)
    if result.returncode != 0:
        print(f"\n[!] Error executing: {cmd}")
        sys.exit(1)

import datetime

def fix_java_home():
    # If the user's JAVA_HOME is broken, try to use Android Studio's bundled JDK
    bundled_jdk = r"C:\Program Files\Android\Android Studio\jbr"
    if os.path.exists(bundled_jdk):
        os.environ["JAVA_HOME"] = bundled_jdk
        # Also prepend it to PATH so keytool is found
        os.environ["PATH"] = os.path.join(bundled_jdk, "bin") + os.pathsep + os.environ.get("PATH", "")
        print(f"      [System] Auto-configured JAVA_HOME to Android Studio's bundled JDK: {bundled_jdk}")

def fix_android_home():
    # If the user's ANDROID_HOME is missing, use the default Windows path
    default_sdk = os.path.join(os.environ.get("LOCALAPPDATA", ""), "Android", "Sdk")
    if os.path.exists(default_sdk):
        os.environ["ANDROID_HOME"] = default_sdk
        print(f"      [System] Auto-configured ANDROID_HOME to: {default_sdk}")

def main():
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    frontend_dir = os.path.join(root_dir, "frontend")
    
    print("========================================")
    print("   Phoenix Fall - Android Auto-Builder")
    print("========================================")
    
    fix_java_home()
    fix_android_home()
    
    # 1. Build Angular App (Do this first so the dist/frontend folder exists for Capacitor)
    print("\n[1/6] Building Angular Frontend...")
    run_cmd("npm run build", cwd=frontend_dir)

    # 2. Ensure Capacitor is installed and initialized
    print("\n[2/6] Verifying Capacitor setup...")
    if not os.path.exists(os.path.join(frontend_dir, "capacitor.config.ts")) and not os.path.exists(os.path.join(frontend_dir, "capacitor.config.json")):
        print("      Installing Capacitor dependencies...")
        run_cmd("npm install @capacitor/core @capacitor/android", cwd=frontend_dir)
        run_cmd("npm install -D @capacitor/cli", cwd=frontend_dir)
        print("      Initializing Capacitor project...")
        run_cmd("npx cap init PhoenixFall com.carter75.phoenixfall --web-dir dist/frontend", cwd=frontend_dir)
    
    # 3. Add Android Platform
    android_dir = os.path.join(frontend_dir, "android")
    if not os.path.exists(android_dir):
        print("      Adding Android Platform...")
        run_cmd("npx cap add android", cwd=frontend_dir)
        
    # 4. Sync Capacitor (copies the dist folder into the android project)
    print("\n[3/6] Syncing Web Assets to Android...")
    run_cmd("npx cap sync android", cwd=frontend_dir)
    
    # 5. Generate Keystore if missing
    print("\n[4/6] Checking for Release Keystore...")
    keystore_path = os.path.join(frontend_dir, "release.keystore")
    if not os.path.exists(keystore_path):
        print("      Generating new Release Keystore...")
        # Note: keytool comes with the Java JDK (which Gradle uses).
        keytool_cmd = (
            f'keytool -genkey -v -keystore "{keystore_path}" -alias release '
            f'-keyalg RSA -keysize 2048 -validity 10000 '
            f'-storepass phoenix123 -keypass phoenix123 '
            f'-dname "CN=PhoenixFall, OU=Game, O=Carter75, L=Unknown, ST=Unknown, C=US"'
        )
        run_cmd(keytool_cmd, cwd=frontend_dir)
    else:
        print("      Found existing keystore!")
        
    # 6. Build APK and AAB with Gradle
    print("\n[5/6] Building Signed APK and AAB via Gradle...")
    gradlew = "gradlew.bat" if os.name == 'nt' else "./gradlew"
    
    # We pass the signing properties directly to gradle CLI so you never have to open Android Studio!
    sign_args = (
        f'-Pandroid.injected.signing.store.file="{keystore_path}" '
        f'-Pandroid.injected.signing.store.password=phoenix123 '
        f'-Pandroid.injected.signing.key.alias=release '
        f'-Pandroid.injected.signing.key.password=phoenix123'
    )
    
    # Build APK
    print("      -> Assembling Release APK...")
    run_cmd(f"{gradlew} assembleRelease {sign_args}", cwd=android_dir)
    
    # Build AAB (App Bundle for Play Store)
    print("      -> Bundling Release AAB...")
    run_cmd(f"{gradlew} bundleRelease {sign_args}", cwd=android_dir)
    
    # 7. Copy Outputs
    print("\n[6/6] Copying outputs to project root...")
    out_dir = os.path.join(root_dir, "android_builds")
    backup_dir = os.path.join(out_dir, "backups")
    os.makedirs(out_dir, exist_ok=True)
    os.makedirs(backup_dir, exist_ok=True)
    
    apk_src = os.path.join(android_dir, "app", "build", "outputs", "apk", "release", "app-release.apk")
    aab_src = os.path.join(android_dir, "app", "build", "outputs", "bundle", "release", "app-release.aab")
    
    apk_dest = os.path.join(out_dir, "PhoenixFall.apk")
    aab_dest = os.path.join(out_dir, "PhoenixFall.aab")
    
    timestamp = datetime.datetime.now().strftime("%Y%m%d_%H%M%S")
    
    # Backup existing builds
    if os.path.exists(apk_dest):
        backup_apk = os.path.join(backup_dir, f"PhoenixFall_{timestamp}.apk")
        shutil.move(apk_dest, backup_apk)
        print(f"      [Backup] Moved existing APK to: {backup_apk}")
        
    if os.path.exists(aab_dest):
        backup_aab = os.path.join(backup_dir, f"PhoenixFall_{timestamp}.aab")
        shutil.move(aab_dest, backup_aab)
        print(f"      [Backup] Moved existing AAB to: {backup_aab}")
    
    if os.path.exists(apk_src):
        shutil.copy(apk_src, apk_dest)
        print(f"      [OK] APK exported to: {apk_dest}")
        
    if os.path.exists(aab_src):
        shutil.copy(aab_src, aab_dest)
        print(f"      [OK] AAB exported to: {aab_dest}")
        
    print("\n========================================")
    print("   ALL DONE! BUILD SUCCESSFUL")
    print("========================================")

if __name__ == "__main__":
    main()
