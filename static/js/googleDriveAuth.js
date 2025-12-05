/**
 * Google Drive Authentication Service
 * Uses Google Identity Services for client-side authentication (no secrets needed)
 *
 * Features:
 * - Persistent authentication using localStorage (survives browser restart)
 * - Automatic silent token refresh when expired
 * - Activity-based proactive token refresh
 * - Background token expiry monitoring
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
        this.lastActivity = Date.now();
        this.refreshTimer = null;
        this.isRefreshing = false;

        // Load token from localStorage if available
        this.loadTokenFromStorage();

        // Initialize Google Identity Services
        this.initGIS();

        // Start activity tracking and automatic refresh
        this.startActivityTracking();
        this.startBackgroundRefresh();
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
                    this.isRefreshing = false;
                    this.saveTokenToStorage();

                    console.log(`Google Drive token ${this.isRefreshing ? 'refreshed' : 'acquired'}, expires in ${Math.round(response.expires_in / 60)} minutes`);

                    // Trigger success event
                    if (this.onAuthSuccess) {
                        this.onAuthSuccess();
                    }
                } else if (response.error) {
                    console.error('Token request failed:', response.error);
                    this.isRefreshing = false;
                }
            },
        });
    }

    /**
     * Load token from localStorage (persistent across browser restarts)
     */
    loadTokenFromStorage() {
        const token = localStorage.getItem('gd_access_token');
        const expiry = localStorage.getItem('gd_token_expiry');
        const lastActivity = localStorage.getItem('gd_last_activity');

        if (token && expiry) {
            this.accessToken = token;
            this.tokenExpiry = parseInt(expiry);
            this.lastActivity = lastActivity ? parseInt(lastActivity) : Date.now();

            // Check if token is expired
            if (this.isTokenExpired()) {
                console.log('Stored token expired, will attempt silent refresh');
                // Don't clear yet - we'll try to refresh silently
            } else {
                const minutesRemaining = Math.round((this.tokenExpiry - Date.now()) / 60000);
                console.log(`Loaded stored token, expires in ${minutesRemaining} minutes`);
            }
        }
    }

    /**
     * Save token to localStorage (persistent)
     */
    saveTokenToStorage() {
        if (this.accessToken) {
            localStorage.setItem('gd_access_token', this.accessToken);
            localStorage.setItem('gd_token_expiry', this.tokenExpiry.toString());
            localStorage.setItem('gd_last_activity', Date.now().toString());
        }
    }

    /**
     * Clear token from localStorage
     */
    clearToken() {
        this.accessToken = null;
        this.tokenExpiry = null;
        localStorage.removeItem('gd_access_token');
        localStorage.removeItem('gd_token_expiry');
        localStorage.removeItem('gd_last_activity');

        // Stop refresh timer
        if (this.refreshTimer) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
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
     * Get valid access token (automatically refresh if expired)
     */
    async getAccessToken() {
        // Update last activity
        this.lastActivity = Date.now();
        localStorage.setItem('gd_last_activity', this.lastActivity.toString());

        // If no token, return null (user needs to login)
        if (!this.accessToken) {
            return null;
        }

        // If token expired, try silent refresh
        if (this.isTokenExpired()) {
            console.log('Token expired, attempting silent refresh...');
            const refreshed = await this.refreshTokenSilently();
            if (!refreshed) {
                console.log('Silent refresh failed, user needs to re-authenticate');
                return null;
            }
        }

        return this.accessToken;
    }

    /**
     * Attempt to refresh token silently (no user interaction)
     */
    async refreshTokenSilently() {
        if (this.isRefreshing || !this.tokenClient) {
            return false;
        }

        return new Promise((resolve) => {
            this.isRefreshing = true;

            // Store original callback
            const originalCallback = this.onAuthSuccess;

            // Temporary callback for this refresh
            this.onAuthSuccess = () => {
                this.onAuthSuccess = originalCallback;
                resolve(true);
            };

            // Try to refresh with prompt: '' to avoid popup
            try {
                this.tokenClient.requestAccessToken({ prompt: '' });

                // Set timeout in case silent refresh fails
                setTimeout(() => {
                    if (this.isRefreshing) {
                        this.isRefreshing = false;
                        this.onAuthSuccess = originalCallback;
                        resolve(false);
                    }
                }, 5000);
            } catch (error) {
                console.error('Silent refresh error:', error);
                this.isRefreshing = false;
                this.onAuthSuccess = originalCallback;
                resolve(false);
            }
        });
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

    /**
     * Start tracking user activity to refresh tokens proactively
     */
    startActivityTracking() {
        // Track various user interactions
        const activityEvents = ['click', 'keypress', 'mousemove', 'scroll', 'touchstart'];

        const updateActivity = () => {
            const now = Date.now();
            // Only update if more than 1 minute since last activity
            if (now - this.lastActivity > 60000) {
                this.lastActivity = now;
                localStorage.setItem('gd_last_activity', now.toString());

                // If user is active and token will expire soon, refresh proactively
                if (this.accessToken && this.shouldRefreshProactively()) {
                    console.log('User active, refreshing token proactively...');
                    this.refreshTokenSilently();
                }
            }
        };

        activityEvents.forEach(event => {
            document.addEventListener(event, updateActivity, { passive: true });
        });
    }

    /**
     * Check if we should refresh token proactively
     * Refresh if token will expire in next 15 minutes
     */
    shouldRefreshProactively() {
        if (!this.tokenExpiry) return false;
        const timeUntilExpiry = this.tokenExpiry - Date.now();
        const fifteenMinutes = 15 * 60 * 1000;
        return timeUntilExpiry < fifteenMinutes && timeUntilExpiry > 0;
    }

    /**
     * Start background timer to check token expiry
     * Runs every 5 minutes
     */
    startBackgroundRefresh() {
        // Check every 5 minutes
        this.refreshTimer = setInterval(() => {
            if (!this.accessToken) return;

            // Check if user was recently active (within last 10 minutes)
            const timeSinceActivity = Date.now() - this.lastActivity;
            const tenMinutes = 10 * 60 * 1000;

            if (timeSinceActivity < tenMinutes && this.shouldRefreshProactively()) {
                console.log('Background refresh: user recently active, refreshing token...');
                this.refreshTokenSilently();
            } else if (this.isTokenExpired()) {
                console.log('Background refresh: token expired and user inactive, clearing token');
                this.clearToken();
            }
        }, 5 * 60 * 1000);
    }
}
