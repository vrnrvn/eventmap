import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as WebBrowser from 'expo-web-browser';
import * as AuthSession from 'expo-auth-session';
import * as QueryParams from 'expo-auth-session/build/QueryParams';
import { supabase } from './supabase';

const GOOGLE_WEB_CLIENT_ID = process.env.EXPO_PUBLIC_GOOGLE_WEB_CLIENT_ID?.trim() || '';

const isExpoGo = Constants.appOwnership === 'expo';

export const authService = {
  async signInWithOAuth(provider: 'google' | 'facebook') {
    const useNativeGoogle =
      provider === 'google' &&
      Platform.OS === 'android' &&
      GOOGLE_WEB_CLIENT_ID &&
      !isExpoGo;
    if (useNativeGoogle) {
      return authService.signInWithGoogleNative();
    }
    return authService.signInWithOAuthWeb(provider);
  },

  async signInWithGoogleNative() {
    const { GoogleSignin, statusCodes } = await import(
      '@react-native-google-signin/google-signin'
    );
    GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID });

    try {
      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();

      if (response.type !== 'success' || !response.data?.idToken) {
        throw new Error('OAuth was cancelled or failed');
      }

      const { data, error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: response.data.idToken,
      });

      if (error) throw error;
      if (!data.user) throw new Error('No user data returned');
      return data;
    } catch (err: unknown) {
      if (err && typeof err === 'object' && 'code' in err) {
        const code = (err as { code: string }).code;
        if (code === statusCodes.SIGN_IN_CANCELLED) {
          throw new Error('OAuth was cancelled or failed');
        }
        if (code === statusCodes.IN_PROGRESS) {
          throw new Error('Sign in already in progress');
        }
        if (code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) {
          throw new Error('Google Play Services not available');
        }
      }
      throw err;
    }
  },

  async signInWithOAuthWeb(provider: 'google' | 'facebook') {
    const redirectTo = AuthSession.makeRedirectUri();

    const { data, error } = await supabase.auth.signInWithOAuth({
      provider,
      options: {
        redirectTo,
        skipBrowserRedirect: true,
      },
    });

    if (error) throw error;
    if (!data?.url) throw new Error('No OAuth URL returned');

    const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);

    if (result.type !== 'success' || !result.url) {
      throw new Error('OAuth was cancelled or failed');
    }

    const { params, errorCode } = QueryParams.getQueryParams(result.url);

    if (errorCode) throw new Error(errorCode);

    const { access_token, refresh_token } = params;

    if (!access_token) throw new Error('No access token in redirect');

    const { data: sessionData, error: setError } =
      await supabase.auth.setSession({ access_token, refresh_token });

    if (setError) throw setError;
    return sessionData;
  },

  async signUp(email: string, password: string, name: string) {
    const { data: authData, error: authError } = await supabase.auth.signUp({
      email,
      password,
      options: {
        data: { name },
      },
    });

    if (authError) throw authError;
    if (!authData.user) throw new Error('No user data returned');

    return authData;
  },

  async signIn(email: string, password: string) {
    const { data, error } = await supabase.auth.signInWithPassword({
      email,
      password,
    });

    if (error) throw error;
    return data;
  },

  async signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) throw error;
  },

  async resetPassword(email: string) {
    const { error } = await supabase.auth.resetPasswordForEmail(email);
    if (error) throw error;
  },

  async updatePassword(newPassword: string) {
    const { error } = await supabase.auth.updateUser({
      password: newPassword,
    });
    if (error) throw error;
  },

  async getSession() {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw error;
    return data.session;
  },

  async getUser() {
    const { data, error } = await supabase.auth.getUser();
    if (error) throw error;
    return data.user;
  },

  onAuthStateChange(callback: (session: any) => void) {
    return supabase.auth.onAuthStateChange((_event, session) => {
      callback(session);
    });
  },
};
