# Bug Fix Documentation: Phase 5 Authentication Issues

**Project**: Event Ticketing System V2  
**Phase**: Phase 5 — React Frontend  
**Date**: March 2026  
**Stack**: AWS Cognito + Amplify v6 + React + TypeScript

---

## Overview

After deploying the Phase 5 frontend, three critical bugs were discovered in the authentication flow. This document explains each bug in detail — what it was, why it happened, how it was diagnosed, and exactly how it was fixed — so you can apply the same approach in any production system.

---

## Bug 1: No OTP Confirmation Screen After Signup

### What the bug was

When a user signed up, the app showed "Account Created! Go to Login" and redirected them to the login page. But when they tried to log in, it failed silently or threw an error. The user was stuck — they had an account but could not log in.

### Why it happened

AWS Cognito requires **email verification** before a user account becomes active. When `signUp()` is called, Cognito:
1. Creates the account in a **UNCONFIRMED** state
2. Sends a 6-digit OTP code to the user's email
3. Waits for `confirmSignUp(email, code)` to be called with that code
4. Only then marks the account as **CONFIRMED** and allows login

The original `SignupPage` called `signUp()` and immediately showed a success screen with a "Go to Login" button. There was no step to collect the OTP code from the user and call `confirmSignUp()`. So users were redirected to login with an unconfirmed account, which Cognito rejects.

### How to diagnose this in production

**Symptom**: User signs up, receives email with a code, but cannot log in. Login shows a generic error or no error at all.

**Check 1**: Look at the Cognito User Pool in AWS Console → Users. Find the user. If their status shows `UNCONFIRMED`, the confirmation step is missing.

**Check 2**: In browser DevTools → Network tab, look at the login request. The Cognito response will contain:
```json
{
  "code": "UserNotConfirmedException",
  "message": "User is not confirmed."
}
```

**Check 3**: In your code, search for `signUp` from `aws-amplify/auth`. If `confirmSignUp` is never called anywhere in the codebase, the confirmation step is missing.

### How it was fixed

**Step 1**: Added `confirmSignUp` to the `AuthContext` so it's available app-wide.

In `frontend/src/context/AuthContext.tsx`:
```typescript
// Added import
import { signIn, signOut, signUp, confirmSignUp, getCurrentUser, fetchAuthSession } from 'aws-amplify/auth';

// Added to AuthContextType interface
confirmAccount: (email: string, code: string) => Promise<void>;

// Added implementation
const confirmAccount = async (email: string, code: string) => {
  await confirmSignUp({ username: email, confirmationCode: code });
};

// Added to Provider value
<AuthContext.Provider value={{ ..., confirmAccount }}>
```

**Step 2**: Converted `SignupPage` from a single-step form to a two-step flow using a `step` state variable.

```typescript
type Step = 'signup' | 'confirm';
const [step, setStep] = useState<Step>('signup');

// After successful signUp():
setStep('confirm'); // Show OTP screen instead of redirecting

// OTP screen renders when step === 'confirm':
// - Shows which email the code was sent to
// - Has a single input field for the 6-digit code
// - Calls confirmAccount(email, code) on submit
// - On success: navigate('/login', { state: { message: 'Account confirmed!' } })
```

**Key insight**: The email must be stored in component state (not lost on re-render) because `confirmSignUp` needs it. Since both steps are in the same component, the `form.email` value persists across the step change.

**Step 3**: The OTP input was styled with `tracking-widest` and `text-center` to make it easy to read the 6-digit code:
```tsx
<input
  type="text"
  maxLength={6}
  placeholder="123456"
  className="text-center text-xl tracking-widest ..."
/>
```

### The complete flow after the fix

```
User fills signup form
        ↓
signUp() called → Cognito sends OTP email
        ↓
setStep('confirm') → OTP screen appears
        ↓
User checks email, enters 6-digit code
        ↓
confirmSignUp() called → Cognito confirms account
        ↓
navigate('/login') with success message
        ↓
User logs in successfully
```

### How to apply this in any production system

Any time you use Cognito with `selfSignUpEnabled: true` and `autoVerify: { email: true }`, you **must** implement this two-step flow. The pattern is always:
1. `signUp()` → show OTP input
2. `confirmSignUp(email, code)` → redirect to login

If you want to skip email verification entirely (not recommended for production), you can set `autoVerify: {}` in the CDK UserPool config, but this removes a security layer.

---

## Bug 2: Login Crashed on Unconfirmed Accounts

### What the bug was

If a user tried to log in before confirming their email (or if the confirmation step was missing as in Bug 1), the login function would either crash silently, show a confusing error, or get stuck in a loading state.

### Why it happened

AWS Amplify v6 changed how `signIn()` works compared to v5. In Amplify v6, `signIn()` returns an object with a `nextStep` field:

```typescript
const result = await signIn({ username: email, password });
// result.nextStep.signInStep can be:
// 'DONE'                    — login successful
// 'CONFIRM_SIGN_UP'         — user hasn't confirmed email yet
// 'CONFIRM_SIGN_IN_WITH_...' — MFA required
// etc.
```

The original login code ignored `nextStep` entirely:
```typescript
// OLD — broken
const login = async (email: string, password: string) => {
  await signIn({ username: email, password }); // ignores return value
  await loadUser(); // crashes if sign-in wasn't actually complete
};
```

When `nextStep` is `CONFIRM_SIGN_UP`, the user is not actually signed in. Calling `loadUser()` immediately after would call `getCurrentUser()` which throws because there's no active session, causing an unhandled error.

Additionally, Cognito error messages are technical and confusing to users:
- `NotAuthorizedException: Incorrect username or password.`
- `UserNotConfirmedException: User is not confirmed.`

These were being shown raw to the user.

### How to diagnose this in production

**Symptom**: Login button spins forever, or shows a cryptic error, or the page goes blank after clicking login.

**Check 1**: In browser DevTools → Console, look for errors after clicking login. You'll see something like:
```
Error: There is already a signed in user.
```
or
```
UserNotConfirmedException: User is not confirmed.
```

**Check 2**: Add a `console.log(result)` after `signIn()` to see what `nextStep` is returning. This tells you exactly what Cognito expects next.

**Check 3**: In Amplify v6 migration docs, search for "nextStep" — this is a breaking change from v5 where `signIn()` was fire-and-forget.

### How it was fixed

**Step 1**: Updated `login()` in `AuthContext` to return `nextStep` to the caller:

```typescript
// NEW — correct
const login = async (email: string, password: string): Promise<{ nextStep: string }> => {
  const result = await signIn({ username: email, password });
  const step = result.nextStep.signInStep;
  
  if (step === 'DONE') {
    await loadUser(); // Only load user if actually signed in
  }
  // Return the step so the UI can decide what to show
  return { nextStep: step };
};
```

**Step 2**: Updated `LoginPage` to handle the returned `nextStep`:

```typescript
const { nextStep } = await login(email, password);

if (nextStep === 'CONFIRM_SIGN_UP') {
  setError('Please confirm your email first. Check your inbox for the verification code.');
} else {
  navigate('/');
}
```

**Step 3**: Added user-friendly error message mapping in the catch block:

```typescript
catch (err: unknown) {
  const msg = err instanceof Error ? err.message : 'Login failed';
  
  if (msg.includes('UserNotConfirmedException') || msg.includes('not confirmed')) {
    setError('Your account is not confirmed yet. Check your email for the verification code.');
  } else if (msg.includes('NotAuthorizedException')) {
    setError('Incorrect email or password.');
  } else {
    setError(msg);
  }
}
```

**Step 4**: Added a success message display when redirected from the signup confirmation:

```typescript
// In LoginPage — reads state passed via navigate()
const location = useLocation();
const successMessage = (location.state as { message?: string })?.message ?? '';

// In JSX:
{successMessage && <p className="text-green-600 text-sm mb-4 text-center">{successMessage}</p>}
```

### How to apply this in any production system

Whenever you use Amplify v6 `signIn()`, always check `nextStep`:

```typescript
const result = await signIn({ username, password });
switch (result.nextStep.signInStep) {
  case 'DONE':
    // Fully signed in
    break;
  case 'CONFIRM_SIGN_UP':
    // Redirect to confirmation page
    break;
  case 'CONFIRM_SIGN_IN_WITH_TOTP_CODE':
    // Show MFA input
    break;
  case 'CONFIRM_SIGN_IN_WITH_SMS_CODE':
    // Show SMS MFA input
    break;
}
```

This pattern applies to any multi-step auth flow. Never assume `signIn()` means the user is fully authenticated.

---

## Bug 3: Role Selection at Signup Did Nothing

### What the bug was

The signup form had a dropdown to choose "Attendee" or "Organizer". But after signing up and logging in, every user was treated as an Attendee regardless of what they selected. Organizers could not see the "Create Event" button or access organizer pages.

### Why it happened

The signup form passed the role via `clientMetadata`:

```typescript
await signUp({
  username: email,
  password,
  options: {
    userAttributes: { email, name },
    clientMetadata: { role }, // 'Organizers' or 'Attendees'
  },
});
```

`clientMetadata` is just a key-value map that gets passed through Cognito's trigger events. **Cognito does not automatically do anything with it.** It does not assign groups, set attributes, or take any action based on `clientMetadata` values.

The frontend reads the user's group from the JWT token:
```typescript
const groups = session.tokens?.idToken?.payload['cognito:groups'] as string[];
```

But since no code ever called `AdminAddUserToGroup`, the `cognito:groups` claim was always empty, so `isOrganizer` was always `false`.

### How to diagnose this in production

**Symptom**: All users see the same UI regardless of their selected role. Organizer-only pages redirect to home.

**Check 1**: After logging in, decode the JWT token. Go to [jwt.io](https://jwt.io) and paste the ID token (you can get it from browser DevTools → Application → Local Storage, or from `fetchAuthSession()`). Look for `cognito:groups` in the payload. If it's missing or empty, users are not in any group.

**Check 2**: In AWS Console → Cognito → User Pool → Users → click a user → check "Group memberships". If it's empty, the group assignment never happened.

**Check 3**: In AWS Console → Cognito → User Pool → User Pool Properties → Triggers. If there's no "Post confirmation" trigger, group assignment is not automated.

### How it was fixed

The fix required a **Cognito Post-Confirmation Lambda trigger** — a Lambda function that Cognito automatically calls after a user confirms their email.

**Step 1**: Created the Lambda function at `lambda/postConfirmation/index.ts`:

```typescript
import { CognitoIdentityProviderClient, AdminAddUserToGroupCommand } from '@aws-sdk/client-cognito-identity-provider';

const cognito = new CognitoIdentityProviderClient({});

export const handler = async (event: {
  userPoolId: string;
  userName: string;
  request: {
    clientMetadata?: Record<string, string>;
  };
}) => {
  // Read the role the user selected at signup
  const role = event.request.clientMetadata?.role;
  
  // Default to Attendees if no role specified
  const group = role === 'Organizers' ? 'Organizers' : 'Attendees';

  // Add the user to the correct Cognito group
  await cognito.send(new AdminAddUserToGroupCommand({
    UserPoolId: event.userPoolId,
    Username: event.userName,
    GroupName: group,
  }));

  // IMPORTANT: Must return the event unchanged — Cognito requires this
  return event;
};
```

**Why `clientMetadata` is available here**: When `signUp()` is called with `clientMetadata`, Cognito passes it through to all trigger events for that user's signup flow, including Post-Confirmation. So `event.request.clientMetadata.role` contains exactly what was passed at signup.

**Step 2**: Added the Lambda to `AuthStack` in `lib/stacks/auth-stack.ts`:

```typescript
// Added imports
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as path from 'path';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';

// Inside constructor, before the User Groups section:
const postConfirmationFn = new NodejsFunction(this, 'PostConfirmationFn', {
  runtime: lambda.Runtime.NODEJS_20_X,
  entry: path.join(__dirname, '../../lambda/postConfirmation/index.ts'),
  handler: 'handler',
  timeout: cdk.Duration.seconds(10),
  bundling: {
    minify: true,
    externalModules: ['@aws-sdk/*'],
    forceDockerBundling: false,
  },
});

// Grant permission to add users to groups
postConfirmationFn.addToRolePolicy(new iam.PolicyStatement({
  actions: ['cognito-idp:AdminAddUserToGroup'],
  resources: ['*'],
}));

// Wire it as the Post-Confirmation trigger
this.userPool.addTrigger(
  cognito.UserPoolOperation.POST_CONFIRMATION,
  postConfirmationFn
);
```

**Step 3**: Added the missing SDK package to root `package.json`:

```bash
npm install @aws-sdk/client-cognito-identity-provider
```

This was needed because the root `tsconfig.json` compiles all Lambda files, and the Cognito SDK wasn't in the dependencies.

**Step 4**: Deployed the updated AuthStack:

```bash
npx cdk deploy event-ticketing-v2-auth-dev --require-approval never
```

**What happens now after the fix**:
```
User confirms email (enters OTP code)
        ↓
Cognito marks account as CONFIRMED
        ↓
Cognito automatically invokes PostConfirmationFn
        ↓
Lambda reads clientMetadata.role from the event
        ↓
Lambda calls AdminAddUserToGroup('Organizers' or 'Attendees')
        ↓
User is now in the correct group
        ↓
Next login: JWT token contains cognito:groups = ['Organizers']
        ↓
isOrganizer = true → organizer UI shown
```

### Important note about existing users

If users signed up **before** this fix was deployed, they are already confirmed but were never added to a group. The Post-Confirmation trigger only fires for **new** confirmations going forward.

**To fix existing users manually**, run this AWS CLI command for each affected user:

```bash
# Add an existing user to the Organizers group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_k7mPLZKd1 \
  --username user@example.com \
  --group-name Organizers \
  --region us-east-1

# Or add to Attendees group
aws cognito-idp admin-add-user-to-group \
  --user-pool-id us-east-1_k7mPLZKd1 \
  --username user@example.com \
  --group-name Attendees \
  --region us-east-1
```

**To list all users and their groups**:
```bash
# List all users in the pool
aws cognito-idp list-users \
  --user-pool-id us-east-1_k7mPLZKd1 \
  --region us-east-1

# List users in a specific group
aws cognito-idp list-users-in-group \
  --user-pool-id us-east-1_k7mPLZKd1 \
  --group-name Organizers \
  --region us-east-1
```

### How to apply this in any production system

Any time you need to assign roles/groups at signup in Cognito, use a Post-Confirmation trigger. The pattern is:

1. Pass the role in `clientMetadata` at `signUp()` time
2. Create a Lambda with `AdminAddUserToGroup` permission
3. Wire it as `UserPoolOperation.POST_CONFIRMATION`
4. The Lambda fires automatically after every email confirmation

Never try to assign groups from the frontend — the frontend has no IAM permissions and `clientMetadata` alone does nothing.

---

## Summary Table

| Bug | Symptom | Root Cause | Fix |
|-----|---------|------------|-----|
| No OTP screen | Can't log in after signup | `confirmSignUp()` never called | Two-step SignupPage with OTP input |
| Login crash | Silent failure or crash on login | Amplify v6 `nextStep` ignored | Check `nextStep` after `signIn()` |
| Role ignored | Everyone is Attendee | `clientMetadata` not acted on | Post-Confirmation Lambda trigger |

---

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/pages/SignupPage.tsx` | Added two-step flow with OTP confirmation screen |
| `frontend/src/pages/LoginPage.tsx` | Handle `nextStep`, friendly error messages, success message |
| `frontend/src/context/AuthContext.tsx` | Added `confirmAccount()`, updated `login()` return type |
| `lambda/postConfirmation/index.ts` | New Lambda — assigns Cognito group on confirmation |
| `lib/stacks/auth-stack.ts` | Added PostConfirmationFn + trigger wiring |
| `package.json` | Added `@aws-sdk/client-cognito-identity-provider` |

---

## Key Concepts to Remember

**Cognito account states**: `UNCONFIRMED` → (OTP confirmed) → `CONFIRMED`. Login only works in `CONFIRMED` state.

**Amplify v6 breaking change**: `signIn()` now returns `nextStep`. Always check it. This is different from Amplify v5 where sign-in was a single async call.

**`clientMetadata` is pass-through only**: It gets forwarded to Lambda triggers but Cognito itself ignores it. You must write a Lambda to act on it.

**Post-Confirmation trigger timing**: It fires after `confirmSignUp()` succeeds, not after `signUp()`. This is the right place for group assignment because the user is now verified.

**JWT groups claim**: The `cognito:groups` claim in the ID token is only populated if the user is in at least one group. It's absent (not empty array) if the user has no groups — always use `?? []` when reading it.

---

# Bug Fix Documentation: Create Event — Field Name Mismatch

**Phase**: Phase 5 — React Frontend (Post-deployment)
**Date**: March 2026
**Stack**: React + TypeScript + API Gateway + Lambda + Zod

---

## Bug 4: "Failed to create event" When Organizer Submits the Create Event Form

### What the bug was

When an organizer filled out the Create Event form and clicked "Create Event", the page showed "Failed to create event" and nothing was saved. The form appeared to work — no validation errors, no network failure — but the API rejected the request every time.

### Why it happened

The frontend form was built with field names that didn't match what the Lambda expected. There were four separate mismatches:

**Mismatch 1 — Field name `title` vs `name`**

The frontend sent:
```json
{ "title": "My Event" }
```
The Lambda's Zod schema expected:
```typescript
const CreateEventSchema = z.object({
  name: z.string().min(1).max(200),  // ← 'name', not 'title'
  ...
});
```
Zod's `safeParse` failed because `name` was missing. The Lambda returned a 400 validation error, which the frontend caught and showed as "Failed to create event".

**Mismatch 2 — Field name `totalCapacity` vs `capacity`**

The frontend sent:
```json
{ "totalCapacity": 100 }
```
The Lambda expected:
```typescript
capacity: z.number().int().positive().max(100000),  // ← 'capacity'
```
Same result — Zod rejected the body.

**Mismatch 3 — Category casing `'Conference'` vs `'conference'`**

The frontend's category dropdown options were capitalized:
```typescript
const categories = ['Conference', 'Workshop', 'Concert', 'Sports', 'Networking', 'Other'];
```
The Lambda's Zod schema used a strict enum with lowercase values:
```typescript
category: z.enum(['conference', 'concert', 'workshop', 'sports', 'other']),
```
So `'Conference'` failed the enum check. Also note: the frontend had `'Networking'` which doesn't exist in the Lambda's enum at all.

**Mismatch 4 — Date format: `datetime-local` vs ISO8601**

The HTML `datetime-local` input produces a string like `'2026-03-21T10:00'` — no timezone, no seconds, no milliseconds. The Lambda's Zod schema used:
```typescript
date: z.string().datetime({ message: 'date must be ISO8601 format' }),
```
`z.string().datetime()` requires a full ISO8601 string like `'2026-03-21T10:00:00.000Z'`. The truncated format from the browser input failed this check.

### How to diagnose this in production

**Symptom**: Form submits, no client-side error, but API returns an error. The error message is generic ("Failed to create event") because the frontend only shows `response.data.message` or falls back to the generic string.

**Check 1**: Open browser DevTools → Network tab → find the POST request to `/v1/events`. Look at:
- Request payload — what fields are actually being sent
- Response body — the Lambda returns `{ "code": "VALIDATION_ERROR", "message": "..." }` with the exact Zod error

**Check 2**: Compare the request payload field names against the Lambda's Zod schema in `lambda/createEvent/index.ts`. Every field name must match exactly — JavaScript is case-sensitive.

**Check 3**: For enum fields, check the exact values in the Zod schema. `z.enum(['conference'])` will reject `'Conference'`.

**Check 4**: For date fields, log `new Date(form.date).toISOString()` in the browser console. If it throws or returns `Invalid Date`, the input value isn't parseable.

**General rule**: Whenever you see a generic "Failed to X" error from an API, always check the Network tab first. The actual error reason is almost always in the response body, not the frontend error message.

### How it was fixed

All fixes were in `frontend/src/pages/CreateEventPage.tsx`.

**Fix 1 & 2 — Rename form state fields to match Lambda schema**:

```typescript
// BEFORE
const [form, setForm] = useState({
  title: '', description: '', date: '', location: '',
  price: 0, totalCapacity: 100, category: 'Conference',
});

// AFTER
const [form, setForm] = useState({
  name: '', description: '', date: '', location: '',
  price: 0, capacity: 100, category: 'conference',
});
```

**Fix 3 — Lowercase category values, remove 'Networking' (not in Lambda enum)**:

```typescript
// BEFORE
const categories = ['Conference', 'Workshop', 'Concert', 'Sports', 'Networking', 'Other'];

// AFTER — values are lowercase to match Zod enum, labels are capitalized for display
const categories = ['conference', 'concert', 'workshop', 'sports', 'other'];

// In JSX — capitalize for display while keeping value lowercase:
{categories.map(c => (
  <option key={c} value={c}>{c.charAt(0).toUpperCase() + c.slice(1)}</option>
))}
```

**Fix 4 — Convert datetime-local to full ISO8601 before sending**:

```typescript
// BEFORE
await apiClient.post('/v1/events', {
  ...form,
  price: Number(form.price),
  totalCapacity: Number(form.totalCapacity),
});

// AFTER — convert date to ISO8601 that Zod's .datetime() accepts
const isoDate = form.date ? new Date(form.date).toISOString() : '';
await apiClient.post('/v1/events', {
  ...form,
  date: isoDate,
  price: Number(form.price),
  capacity: Number(form.capacity),
});
```

`new Date('2026-03-21T10:00').toISOString()` produces `'2026-03-21T10:00:00.000Z'` which passes Zod's `.datetime()` check.

### Cascading fix — display pages also used wrong field names

The same `title` / `totalCapacity` mismatch existed in the pages that *read* events from the API. Since the Lambda stores `name` and `capacity` in DynamoDB and returns them in the response, these pages were rendering blank event titles and wrong capacity numbers.

Fixed in three files:

**`BrowseEventsPage.tsx`**:
```typescript
// Interface: title → name, totalCapacity → capacity
interface Event {
  name: string;       // was: title
  capacity: number;   // was: totalCapacity
  ...
}

// JSX: event.title → event.name, event.totalCapacity → event.capacity
<h2>{event.name}</h2>
<p>🎟 {event.availableCapacity} / {event.capacity} spots left</p>
```

**`MyEventsPage.tsx`**:
```typescript
interface Event {
  name: string;       // was: title
  capacity: number;   // was: totalCapacity
  ...
}

<h2>{event.name}</h2>
<p>{event.capacity - event.availableCapacity} registered / {event.capacity} capacity</p>
```

**`EventDetailPage.tsx`**:
```typescript
interface Event {
  name: string;       // was: title
  capacity: number;   // was: totalCapacity
  ...
}

<h1>{event.name}</h1>
<p>🎟 {event.availableCapacity} of {event.capacity} spots remaining</p>
```

### Note on price field

The Lambda stores price as **integer cents** (e.g., `1000` = $10.00), not dollars. The form label was updated to say "Price (in cents, 0 = free)" to make this clear. If you want to accept dollars in the frontend and convert to cents before sending, do:

```typescript
price: Math.round(Number(form.price) * 100),
```

And update the Lambda schema to accept `z.number().min(0)` (remove `.int()` if you want to allow decimal dollar input on the frontend side).

### How to apply this in any production system

**Always define a shared type/schema** between frontend and backend. Options:

1. **Zod on both sides** — define the schema once, import it in both Lambda and frontend (works if they share a monorepo)
2. **OpenAPI spec** — define the API contract in an OpenAPI YAML, generate TypeScript types for the frontend and validation for the backend
3. **Manual interface sync** — at minimum, keep a comment in the frontend interface pointing to the Lambda schema file

The root cause here was that the frontend interface was written independently from the Lambda schema, with slightly different naming conventions (`title` vs `name`, camelCase vs camelCase but different words). This is a very common bug in full-stack projects.

**For datetime inputs specifically**: Always convert `datetime-local` values with `new Date(value).toISOString()` before sending to any API that uses ISO8601 validation. The browser's native datetime-local format is not ISO8601-compliant.

---

## Updated Summary Table

| Bug | Symptom | Root Cause | Fix |
|-----|---------|------------|-----|
| No OTP screen | Can't log in after signup | `confirmSignUp()` never called | Two-step SignupPage with OTP input |
| Login crash | Silent failure or crash on login | Amplify v6 `nextStep` ignored | Check `nextStep` after `signIn()` |
| Role ignored | Everyone is Attendee | `clientMetadata` not acted on | Post-Confirmation Lambda trigger |
| Create event fails | "Failed to create event" on submit | Frontend field names didn't match Lambda Zod schema | Rename fields, fix casing, convert date to ISO8601 |

## Updated Files Changed

| File | Change |
|------|--------|
| `frontend/src/pages/CreateEventPage.tsx` | Renamed `title`→`name`, `totalCapacity`→`capacity`; lowercase categories; ISO8601 date conversion |
| `frontend/src/pages/BrowseEventsPage.tsx` | Updated interface and JSX to use `name` and `capacity` |
| `frontend/src/pages/MyEventsPage.tsx` | Updated interface and JSX to use `name` and `capacity` |
| `frontend/src/pages/EventDetailPage.tsx` | Updated interface and JSX to use `name` and `capacity` |

---

# Bug Fix Documentation: Ticket Generation Failure + Latency Alarm

**Phase**: Phase 5 — Post-deployment
**Date**: March 2026
**Stack**: Lambda (generateTicket) + SQS + DynamoDB

---

## Bug 5: Registration Succeeds But No Ticket Generated — DynamoDB GSI Key Size Exceeded

### What the bug was

After registering for an event, the frontend showed "✅ Registration successful! Your ticket will be emailed to you shortly." — but no ticket ever arrived. The registration was saved in DynamoDB and the SQS message was sent, but the `generateTicket` Lambda was silently failing every time. A CloudWatch latency alarm also fired because the Lambda was taking 1200–2000ms before crashing.

### Why it happened

The `generateTicket` Lambda generates a QR code as a base64-encoded PNG string (~5028 bytes) and then tries to save it to DynamoDB as the `qrCode` field on the ticket item.

The tickets table has a GSI called `QRCodeIndex` with `qrCode` as the partition key:

```typescript
// In database-stack.ts
this.ticketsTable.addGlobalSecondaryIndex({
  indexName: 'QRCodeIndex',
  partitionKey: { name: 'qrCode', type: dynamodb.AttributeType.STRING },
  projectionType: dynamodb.ProjectionType.ALL,
});
```

**DynamoDB has a hard limit: GSI key attribute values cannot exceed 2048 bytes.** The QR code base64 string was 5028 bytes — more than double the limit. Every `PutCommand` to the tickets table threw a `ValidationException`:

```
ValidationException: One or more parameter values were invalid:
Size limit exceeded for Index Key qrCode
Actual Size: 5028 bytes Max Size: 2048 bytes IndexName: QRCodeIndex
```

Because the Lambda threw on every attempt, SQS retried the message 3 times (the `maxReceiveCount` setting), then moved it to the Dead Letter Queue. The ticket was never generated.

### Why the latency alarm fired

The `generateTicket` Lambda was being invoked, spending ~1200–2000ms generating the QR code and PDF, then crashing on the DynamoDB write. This showed up as high p99 latency on the API Gateway latency alarm (because the `createRegistration` Lambda — which triggers the SQS message — was also cold-starting and taking 1200ms+). The alarm threshold was 1000ms.

### How to diagnose this in production

**Symptom**: Registration succeeds (201 response), but ticket never arrives. No error shown to user.

**Check 1**: CloudWatch Logs for the `generateTicket` Lambda. Filter by `ERROR`. You'll see the exact `ValidationException` with the field name and sizes.

**Check 2**: SQS console → check the DLQ (`event-ticketing-v2-ticket-generation-dlq-dev.fifo`). If messages are accumulating there, the `generateTicket` Lambda is failing after all retries.

**Check 3**: Check the main SQS queue's `ApproximateNumberOfMessagesNotVisible` — if it's > 0 and not decreasing, messages are being processed but failing.

**Check 4**: In DynamoDB console → Tables → tickets table → Indexes tab. Look at the GSI definitions. If any GSI uses a field that could be large (like a base64 string, JSON blob, or URL), it will hit the 2048-byte limit.

**AWS CLI to check DLQ message count**:
```bash
aws sqs get-queue-attributes \
  --queue-url "https://sqs.us-east-1.amazonaws.com/ACCOUNT_ID/your-dlq-name.fifo" \
  --attribute-names ApproximateNumberOfMessages \
  --region us-east-1
```

**AWS CLI to check Lambda logs**:
```bash
# First find the log group name
aws logs describe-log-groups \
  --log-group-name-prefix "/aws/lambda/your-function-prefix" \
  --region us-east-1 \
  --query 'logGroups[*].logGroupName'

# Then filter for errors
aws logs filter-log-events \
  --log-group-name "/aws/lambda/YOUR_FUNCTION_LOG_GROUP" \
  --start-time $(python3 -c "import time; print(int((time.time()-3600)*1000))") \
  --filter-pattern "ERROR" \
  --region us-east-1 \
  --query 'events[*].message'
```

### How it was fixed

**Root cause analysis**: The `qrCode` field (base64 PNG) was being stored in DynamoDB purely as a convenience. But:
1. The QR code is already embedded in the PDF uploaded to S3 — it doesn't need to be in DynamoDB too
2. The `validateTicket` Lambda doesn't use `QRCodeIndex` at all — it reads the ticket by `ticketId` (which is embedded in the QR payload JSON)
3. The `QRCodeIndex` GSI was designed for a lookup pattern that was never actually implemented

**Fix**: Removed `qrCode` from the DynamoDB ticket item in `lambda/generateTicket/index.ts`:

```typescript
// BEFORE — crashes with ValidationException
const ticketItem = {
  ticketId: registrationId,
  registrationId,
  eventId,
  userId,
  qrCode: qrCodeBase64,  // ← 5028 bytes, exceeds 2048-byte GSI key limit
  status: 'generated',
  generatedAt: now,
  s3Key,
  eventName,
  eventDate,
  eventLocation,
  attendeeName: userName,
};

// AFTER — works correctly
const ticketItem = {
  ticketId: registrationId,
  registrationId,
  eventId,
  userId,
  // qrCode removed — it's in the PDF on S3, not needed in DynamoDB
  status: 'generated',
  generatedAt: now,
  s3Key,
  eventName,
  eventDate,
  eventLocation,
  attendeeName: userName,
};
```

The `QRCodeIndex` GSI remains in the table but is now empty. You cannot delete a GSI from an existing DynamoDB table without recreating the table, so it's left in place harmlessly.

### About the latency alarm

The alarm (`event-ticketing-v2-dev-ApiLatencyAlarm`) fired because:
- `createRegistration` Lambda was cold-starting (first invocation after a long idle period)
- Cold start + DynamoDB reads + SQS send = ~1200–1500ms, exceeding the 1000ms p99 threshold

This is expected behavior for a dev environment with infrequent traffic. Lambda cold starts are normal when functions haven't been invoked recently. In production, you'd use **Provisioned Concurrency** to keep Lambdas warm, or accept that the first request after idle will be slow.

The alarm is working correctly — it correctly detected a slow Lambda. The underlying cause (the generateTicket crash causing SQS retries which caused repeated cold starts) is now fixed.

### How to apply this in any production system

**DynamoDB GSI key size limits**:
- Partition key: max 2048 bytes
- Sort key: max 1024 bytes
- These limits apply to the *value* stored in the item, not just the key definition

**Never use large strings as GSI keys**:
- Base64-encoded data (images, PDFs, binary)
- Long JSON strings
- URLs that could be long
- Free-text fields

**If you need to index large data**, store a hash of it instead:
```typescript
import { createHash } from 'crypto';
const qrCodeHash = createHash('sha256').update(qrCodeBase64).digest('hex'); // 64 chars, always
// Store qrCodeHash as the GSI key, qrCodeBase64 as a regular attribute
```

**Always check your GSI key fields** when designing DynamoDB schemas. Ask: "Could this value ever exceed 2048 bytes?" If yes, use a hash or a different lookup strategy.

**SQS + Lambda retry behavior**:
- When a Lambda throws, SQS makes the message visible again after the visibility timeout
- After `maxReceiveCount` failures (3 in this project), the message goes to the DLQ
- Messages in the DLQ are NOT automatically retried — you must manually redrive them or purge them
- Always check the DLQ when a background job seems to silently fail

---

## Updated Summary Table

| Bug | Symptom | Root Cause | Fix |
|-----|---------|------------|-----|
| No OTP screen | Can't log in after signup | `confirmSignUp()` never called | Two-step SignupPage with OTP input |
| Login crash | Silent failure or crash on login | Amplify v6 `nextStep` ignored | Check `nextStep` after `signIn()` |
| Role ignored | Everyone is Attendee | `clientMetadata` not acted on | Post-Confirmation Lambda trigger |
| Create event fails | "Failed to create event" on submit | Frontend field names didn't match Lambda Zod schema | Rename fields, fix casing, convert date to ISO8601 |
| No ticket generated | Registration succeeds, no ticket email | QR code base64 (5028B) exceeded DynamoDB GSI key limit (2048B) | Remove `qrCode` from DynamoDB item; keep it only in S3 PDF |
