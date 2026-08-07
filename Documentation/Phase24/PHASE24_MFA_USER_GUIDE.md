# PHASE24_MFA_USER_GUIDE.md
## Phase 24 MFA User Guide

**Date:** 2026-08-05
**Version:** 1.0

---

## 1. OVERVIEW

### 1.1 What is MFA?

Multi-Factor Authentication (MFA) adds an extra layer of security to your account. When enabled, you'll need to provide a second form of verification (a code from your authenticator app) in addition to your password.

### 1.2 Why Use MFA?

- Protects against password theft
- Prevents unauthorized access
- Industry standard security practice
- Required for sensitive operations

---

## 2. GETTING STARTED

### 2.1 Enable MFA

1. Log in to your account
2. Go to Settings > Security
3. Click "Enable MFA"
4. Scan the QR code with your authenticator app
5. Enter the 6-digit code from your app
6. Save your backup codes in a safe place

### 2.2 Recommended Authenticator Apps

- Google Authenticator
- Microsoft Authenticator
- Authy
- 1Password

---

## 3. USING MFA

### 3.1 Login with MFA

1. Enter your username and password
2. If MFA is enabled, you'll be prompted for a code
3. Open your authenticator app
4. Enter the 6-digit code
5. Click "Verify"

### 3.2 Backup Codes

If you lose access to your authenticator app:

1. Click "Use backup code" on the login screen
2. Enter one of your backup codes
3. Each code can only be used once

---

## 4. MANAGING MFA

### 4.1 Disable MFA

1. Log in to your account
2. Go to Settings > Security
3. Click "Disable MFA"
4. Enter your current MFA code
5. Confirm disable

### 4.2 Regenerate Backup Codes

1. Log in to your account
2. Go to Settings > Security
3. Click "Regenerate Backup Codes"
4. Enter your MFA code
5. Save the new backup codes

---

## 5. TROUBLESHOOTING

### 5.1 Common Issues

| Issue | Solution |
|------|----------|
| Code not working | Check time sync on your device |
| Lost authenticator app | Use backup codes |
| Lost backup codes | Contact support |
| Code expired | Wait for new code (30 seconds) |

### 5.2 Time Sync Issues

If your codes aren't working:

1. Check your device time is correct
2. Enable automatic time sync
3. Try again in 30 seconds

---

## 6. SECURITY TIPS

1. **Save backup codes** in a secure location
2. **Don't share** your MFA codes
3. **Use a strong password** even with MFA
4. **Keep your authenticator app** up to date
5. **Report suspicious activity** immediately

---

## 7. API REFERENCE

### 7.1 Enable MFA

```http
POST /api/v1/auth/mfa/enable
Authorization: Bearer <token>

{
  "secret": "<mfa-secret>",
  "token": "<6-digit-code>"
}
```

### 7.2 Disable MFA

```http
POST /api/v1/auth/mfa/disable
Authorization: Bearer <token>

{
  "token": "<6-digit-code>"
}
```

### 7.3 Verify MFA

```http
POST /api/v1/auth/mfa/verify
Authorization: Bearer <token>

{
  "token": "<6-digit-code>"
}
```

### 7.4 Get MFA Status

```http
GET /api/v1/auth/mfa/status
Authorization: Bearer <token>
```

---

**Document Generated:** 2026-08-05
