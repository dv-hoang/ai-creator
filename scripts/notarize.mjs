import { notarize } from "@electron/notarize";

/**
 * electron-builder afterSign hook.
 * Notarization runs only when required Apple credentials are provided.
 */
export default async function notarizeApp(context) {
  const { electronPlatformName, appOutDir, packager } = context;
  if (electronPlatformName !== "darwin") {
    return;
  }

  const appleId = process.env.APPLE_ID;
  const applePassword = process.env.APPLE_APP_SPECIFIC_PASSWORD;
  const teamId = process.env.APPLE_TEAM_ID;
  const appBundleId = packager.appInfo.id;
  const appName = packager.appInfo.productFilename;

  if (!appleId || !applePassword || !teamId) {
    console.log(
      "[notarize] Skipped (missing APPLE_ID / APPLE_APP_SPECIFIC_PASSWORD / APPLE_TEAM_ID)."
    );
    return;
  }

  await notarize({
    appBundleId,
    appPath: `${appOutDir}/${appName}.app`,
    appleId,
    appleIdPassword: applePassword,
    teamId
  });
}
