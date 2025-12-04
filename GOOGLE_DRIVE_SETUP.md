# Google Drive Sync Setup Guide

This guide explains how to configure Google Drive sync for AgentFlow UI using Google Identity Services.

## Prerequisites

- A Google account
- Access to Google Cloud Console

## Step 1: Create a Google Cloud Project

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Click "Select a project" → "New Project"
3. Enter project name: `AgentFlow UI`
4. Click "Create"

## Step 2: Enable Google Drive API

1. In the Google Cloud Console, go to "APIs & Services" → "Library"
2. Search for "Google Drive API"
3. Click on it and press "Enable"

## Step 3: Configure OAuth Consent Screen

1. Go to "APIs & Services" → "OAuth consent screen"
2. Select "External" user type
3. Click "Create"
4. Fill in the required information:
   - **App name**: AgentFlow UI
   - **User support email**: Your email
   - **Developer contact information**: Your email
5. Click "Save and Continue"
6. On the "Scopes" page, click "Add or Remove Scopes"
7. Search for `https://www.googleapis.com/auth/drive.file`
8. Select it and click "Update"
9. Click "Save and Continue"
10. On "Test users" page, add your email address
11. Click "Save and Continue"

## Step 4: Create OAuth 2.0 Client ID

1. Go to "APIs & Services" → "Credentials"
2. Click "Create Credentials" → "OAuth client ID"
3. Select "Web application" as application type
4. Enter name: `AgentFlow Web Client`
5. Under "Authorized JavaScript origins", add:
   - `http://localhost:8080` (for local development)
   - Your production URL (if deploying, must use HTTPS)
6. **Important**: Do NOT add any "Authorized redirect URIs" - Google Identity Services doesn't use redirect URIs
7. Click "Create"
8. **Important**: Copy the "Client ID" (format: `xxxxx.apps.googleusercontent.com`)

## Step 5: Configure AgentFlow UI

1. Open `static/js/googleDriveAuth.js`
2. Find the line:
   ```javascript
   this.clientId = 'YOUR_CLIENT_ID.apps.googleusercontent.com';
   ```
3. Replace `YOUR_CLIENT_ID.apps.googleusercontent.com` with your actual Client ID from Step 4
4. Save the file
5. **No client secret needed** - Google Identity Services uses a different authentication flow that doesn't require secrets

## Step 6: Test the Integration

1. Start your local server:
   ```bash
   # Example with Python
   python3 -m http.server 8080
   ```

2. Open your browser to `http://localhost:8080`

3. In the sidebar, under "Google Drive Sync", click "Connect"

4. A popup window will appear with Google's consent screen
   - If you see a warning "This app isn't verified", click "Advanced" → "Go to AgentFlow UI (unsafe)"
   - This is normal for apps in testing mode

5. Grant permissions to access your Google Drive

6. The popup will close automatically

7. The sync status should show "Online" with a green indicator

## How It Works

### Data Storage

AgentFlow UI creates a folder structure in your Google Drive:

```
Google Drive/
└── AgentFlowUI/
    ├── conversations/
    │   ├── conv_123456789.json
    │   └── conv_987654321.json
    └── artifacts/
        ├── audio_abc.m4a
        └── image_xyz.png
```

### Sync Behavior

- **Auto-sync**: Conversations are automatically synced every 5 minutes
- **Manual sync**: Click "Sync Now" to force an immediate sync
- **Conflict resolution**: Last modified version wins
- **Offline mode**: Works offline with local IndexedDB cache

### Privacy & Security

- **Google Identity Services**: Uses Google's modern, secure authentication library designed for client-side apps
- **No Secrets**: No client secrets or sensitive credentials embedded in the code - safe to distribute
- **Limited Scope**: Only accesses files created by AgentFlow (not your entire Drive)
- **Local Cache**: Conversations are cached locally in IndexedDB for offline access
- **Session Storage**: Access tokens are stored in browser session (cleared when you close the tab)

## Troubleshooting

### "Popup blocked" or nothing happens

**Problem**: After clicking "Connect", nothing happens.

**Solutions**:
1. Check if your browser blocked the popup - look for a blocked popup icon in the address bar
2. Allow popups for localhost:8080 (or your domain)
3. Try again

### "Origin not allowed"

**Problem**: Error saying the origin is not authorized.

**Solutions**:
1. Check that your JavaScript origin in Google Cloud Console matches your actual URL exactly
2. Make sure the Client ID in `googleDriveAuth.js` is correct
3. Wait 30-60 seconds after saving changes in Google Cloud Console for them to propagate
4. Clear browser cache and try again

### "Sync failed" notification

**Problem**: Sync status shows error.

**Solutions**:
1. Check your internet connection
2. Click "Disconnect" and then "Connect" again to refresh the token
3. Check browser console for detailed error messages

### "This app isn't verified" warning

**Problem**: Google shows a warning when connecting.

**Why**: Your app is in testing mode.

**Solutions**:
1. For personal use, click "Advanced" → "Go to AgentFlow UI (unsafe)"
2. For production, submit your app for verification in Google Cloud Console

### Sync is slow

**Why**: Google Drive API has rate limits.

**Solutions**:
- Syncs are batched every 5 minutes to avoid rate limits
- Manual sync processes the queue immediately but may still be rate-limited
- This is normal behavior

## Production Deployment

When deploying to production:

1. Add your production domain (must use HTTPS) to "Authorized JavaScript origins" in Google Cloud Console
   - Example: `https://yourdomain.com`
2. The Client ID in `googleDriveAuth.js` stays the same - no changes needed
3. Consider publishing your app for OAuth verification to remove the "unverified app" warning screen
4. Monitor API quotas in Google Cloud Console

## Security Best Practices

1. **Safe to commit**: Client ID can be safely committed to public repositories (it's not a secret with Google Identity Services)
2. **Use HTTPS**: Always use HTTPS in production - HTTP only for local development
3. **Restrict origins**: In Google Cloud Console, only add the exact origins you need (localhost for dev, your domain for prod)
4. **Review scopes**: Regularly review the OAuth scopes and only request what you need
5. **Revoke access**: Users can revoke access anytime from: https://myaccount.google.com/permissions

## API Quotas

Google Drive API has the following default quotas:

- **Queries per day**: 1,000,000,000
- **Queries per 100 seconds**: 1,000

For AgentFlow UI normal usage, these limits should never be reached.

## Support

If you encounter issues:

1. Check the browser console for error messages
2. Review the troubleshooting section above
3. Ensure all setup steps were followed correctly
4. Open an issue on GitHub with console logs

## Additional Resources

- [Google Drive API Documentation](https://developers.google.com/drive/api/guides/about-sdk)
- [OAuth 2.0 for Client-side Web Applications](https://developers.google.com/identity/protocols/oauth2/javascript-implicit-flow)
- [Google Cloud Console](https://console.cloud.google.com/)
