import { NextResponse } from 'next/server';

export async function GET() {
  return NextResponse.json({
    status: 'ok',
    service: 'eykon-web',
    timestamp: new Date().toISOString(),
    version: '2.0.0',
  });
}
