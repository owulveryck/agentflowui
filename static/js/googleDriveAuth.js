/**
 * Google Drive Authentication Service
 * Uses Google Identity Services for client-side authentication (no secrets needed)
 */
class GoogleDriveAuth {
    constructor() {
        // Get Client ID from config (or use default)
        this.clientId = window.CONFIG?.GOOGLE_CLIENT_ID || '977022625984-6ban9pp4lc2rdrc9g19vg7jqjlov1taa.apps.googleusercontent.com';

        // Scope: access to files created by this app
        this.scopes = 'https://www.googleapis.com/auth/drive.file';

        this.accessToken = null;
        this.tokenExpiry = null;
        this.tokenClient = null;

        // Load token from sessionStorage if available
        this.loadTokenFromSession();

        // Initialize Google Identity Services
        this.initGIS();
    }

    /**
     * Initialize Google Identity Services
     */
    initGIS() {
        // Load GIS library if not already loaded
        if (!window.google?.accounts?.oauth2) {
            const script = document.createElement('script');
            script.src = 'https://accounts.google.com/gsi/client';
            script.async = true;
            script.defer = true;
            script.onload = () => this.createTokenClient();
            document.head.appendChild(script);
        } else {
            this.createTokenClient();
        }
    }

    /**
     * Create token client for OAuth flow
     */
    createTokenClient() {
        this.tokenClient = google.accounts.oauth2.initTokenClient({
            client_id: this.clientId,
            scope: this.scopes,
            callback: (response) => {
                if (response.access_token) {
                    this.accessToken = response.access_token;
                    this.tokenExpiry = Date.now() + (response.expires_in * 1000);
                    this.saveTokenToSession();

                    // Trigger success event
                    if (this.onAuthSuccess) {
                        this.onAuthSuccess();
                    }
                }
            },
        });
    }

    /**
     * Load token from sessionStorage
     */
    loadTokenFromSession() {
        const token = sessionStorage.getItem('gd_access_token');
        const expiry = sessionStorage.getItem('gd_token_expiry');

        if (token && expiry) {
            this.accessToken = token;
            this.tokenExpiry = parseInt(expiry);

            // Check if expired
            if (this.isTokenExpired()) {
                this.clearToken();
            }
        }
    }

    /**
     * Save token to sessionStorage
     */
    saveTokenToSession() {
        if (this.accessToken) {
            sessionStorage.setItem('gd_access_token', this.accessToken);
            sessionStorage.setItem('gd_token_expiry', this.tokenExpiry.toString());
        }
    }

    /**
     * Clear token from sessionStorage
     */
    clearToken() {
        this.accessToken = null;
        this.tokenExpiry = null;
        sessionStorage.removeItem('gd_access_token');
        sessionStorage.removeItem('gd_token_expiry');
    }

    /**
     * Check if token is expired
     */
    isTokenExpired() {
        if (!this.tokenExpiry) return true;
        // Add 5 minute buffer
        return Date.now() >= (this.tokenExpiry - 5 * 60 * 1000);
    }

    /**
     * Check if authenticated
     */
    isAuthenticated() {
        return this.accessToken && !this.isTokenExpired();
    }

    /**
     * Start OAuth flow using Google Identity Services
     */
    async login() {
        if (!this.tokenClient) {
            console.error('Token client not initialized yet');
            return;
        }

        // Request access token
        this.tokenClient.requestAccessToken();
    }

    /**
     * Get valid access token (request new one if expired)
     */
    async getAccessToken() {
        if (!this.accessToken || this.isTokenExpired()) {
            // Token expired or missing - user needs to re-authenticate
            return null;
        }

        return this.accessToken;
    }

    /**
     * Logout
     */
    async logout() {
        // Revoke token using GIS
        if (this.accessToken && window.google?.accounts?.oauth2) {
            try {
                google.accounts.oauth2.revoke(this.accessToken, (response) => {
                    console.log('Token revoked:', response);
                });
            } catch (error) {
                console.error('Token revocation error:', error);
            }
        }

        this.clearToken();
    }
}
