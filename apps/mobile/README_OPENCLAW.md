# Iliagpt Mobile (React Native)

This folder was scaffolded with `create-expo-app`.

## Quick start

```bash
cd apps/mobile
npm run start
```

## EAS (build packaging)

Install EAS CLI:

```bash
npm i -g eas-cli
```

Login:

```bash
eas login
```

Configure the project:

```bash
cd apps/mobile
eas build:configure
```

Then build:

```bash
# Android (APK/AAB)
eas build -p android --profile preview

# iOS (requires Apple Developer account)
eas build -p ios --profile preview
```

## Notes
- We will share types/api clients with the web app via a future `packages/shared` workspace.
- Auth (Google/Microsoft), push notifications, camera, and offline cache will be added after the scaffold.
