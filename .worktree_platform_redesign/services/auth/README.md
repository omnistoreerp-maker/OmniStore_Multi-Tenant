# OmniStore Authentication & Authorization Preview

Phase 23 defines a complete mock authentication architecture without a backend.

- No real login or logout
- No user creation
- No password collection or storage
- No real sessions
- No cookies, browser session storage, or authentication tokens
- No API, Supabase, Firebase, Auth0, SQL, or database

Login Preview accepts only a mock user id. Password Policy accepts a transient candidate and returns checks without echoing or retaining it.

```js
const auth = OmniAuthPreview.AuthenticationEngine.createEngine();
const result = auth.previewLogin({ userId: 'mock-manager' });
console.log(result.mockSession);
```
