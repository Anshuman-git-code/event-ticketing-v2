# Event Ticketing System V2

> **Status: Active Development** — Phase 5 of 6 complete. Core features are working; payment integration is planned for Phase 6.

A full-stack event ticketing platform built on AWS serverless infrastructure. Organizers can create and manage events, attendees can register and receive PDF tickets with QR codes, and tickets can be validated at the door.

---

## What's Working Right Now

- User signup and login (with email verification and role selection)
- Organizers can create, edit, and delete events
- Attendees can browse events and register
- PDF tickets with QR codes are generated automatically after registration
- Ticket download from the "My Tickets" page
- QR code ticket validation for organizers
- CloudFront-hosted React frontend

> Payment is currently **simulated** — no real card is charged. Stripe integration is planned for Phase 6.

---

## Tech Stack

**Frontend**
- React + TypeScript + Vite
- Tailwind CSS
- AWS Amplify v6 (auth)
- Hosted on CloudFront + S3

**Backend**
- AWS Lambda (Node.js 20, TypeScript)
- API Gateway HTTP API v2
- DynamoDB (events, registrations, tickets)
- SQS FIFO queue (async ticket generation)
- S3 (PDF ticket storage)
- AWS Cognito (auth + user groups)
- AWS CDK (infrastructure as code)

**Observability**
- CloudWatch alarms (latency, errors, DLQ depth)
- AWS X-Ray tracing
- Lambda Powertools (structured logging + metrics)

---

## Project Structure

```
├── lambda/              # Lambda function handlers (one folder per function)
├── lib/
│   ├── stacks/          # CDK stacks (auth, api, database, messaging, storage, etc.)
│   └── constructs/      # Reusable CDK constructs
├── frontend/            # React app (Vite + Tailwind)
│   └── src/
│       ├── pages/       # Route-level page components
│       ├── components/  # Shared UI components
│       ├── context/     # Auth context (Amplify)
│       └── api/         # Axios client
├── implementation_doc/  # Phase guides, design docs, task list, bug fix log
└── cdk.json
```

---

## Development Phases

| Phase | What | Status |
|-------|------|--------|
| 1 | CDK project setup, repo, CI/CD skeleton | ✅ Done |
| 2 | Core AWS infrastructure (VPC, KMS, WAF, S3, SQS) | ✅ Done |
| 3 | Lambda functions + API Gateway | ✅ Done |
| 4 | CI/CD pipeline + CloudWatch observability | ✅ Done |
| 5 | React frontend + CloudFront deployment | ✅ Done |
| 6 | Stripe payment integration | 🔜 Planned |

Full details in [`implementation_doc/`](./implementation_doc/).

---

## Local Development

### Prerequisites
- Node.js 20+
- AWS CLI configured
- AWS CDK v2 installed (`npm install -g aws-cdk`)

### Frontend

```bash
cd frontend
cp .env.example .env   # fill in your API URL and Cognito config
npm install
npm run dev            # runs on http://localhost:5173
```

### Backend (deploy to AWS)

```bash
npm install
npx cdk deploy --all   # deploys all stacks
```

Environment variables for the frontend are in `frontend/.env.example`.

---

## Documentation

All implementation guides and design docs live in [`implementation_doc/`](./implementation_doc/):

- `requirements.md` — project requirements
- `design.md` — architecture and design decisions
- `tasks.md` — full task breakdown
- `phase1-implementation-guide.md` through `phase5-implementation-guide.md` — step-by-step guides per phase
- `bug-fixes.md` — documented bugs found post-deployment and how they were fixed

---

## Known Limitations (Development Phase)

- Payment is simulated (no Stripe yet)
- Ticket emails are not sent — tickets are available for download in the app
- No admin dashboard yet
- WAF is deployed but not yet associated with the API (HTTP API v2 limitation)
