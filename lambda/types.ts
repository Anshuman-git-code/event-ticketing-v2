// Shared types used across all Lambda functions

export interface Event {
  eventId: string;
  organizerId: string;
  name: string;
  description: string;
  date: string;           // ISO8601
  location: string;
  capacity: number;
  availableCapacity: number;
  price: number;          // USD cents (e.g., 2500 = $25.00)
  category: string;       // "conference" | "concert" | "workshop" | "sports" | "other"
  status: string;         // "active" | "sold_out" | "cancelled"
  createdAt: string;
  updatedAt: string;
}

export interface Registration {
  registrationId: string;
  eventId: string;
  userId: string;
  userName: string;
  userEmail: string;
  registeredAt: string;
  paymentStatus: string;  // "pending" | "confirmed" | "failed"
  amount: number;
  ticketId?: string;
  idempotencyKey: string;
}

export interface Ticket {
  ticketId: string;
  registrationId: string;
  eventId: string;
  userId: string;
  qrCode: string;
  status: string;         // "generated" | "validated"
  generatedAt: string;
  validatedAt?: string;
  s3Key: string;
  eventName: string;
  eventDate: string;
  eventLocation: string;
  attendeeName: string;
}

// Standard API error response
export interface ApiError {
  error: {
    code: string;
    message: string;
    correlationId?: string;
  };
}

// Helper to build a success response
export function successResponse(statusCode: number, body: unknown) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  };
}

// Helper to build an error response
export function errorResponse(statusCode: number, code: string, message: string) {
  return {
    statusCode,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ error: { code, message } }),
  };
}