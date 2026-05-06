import { redirect } from 'next/navigation';

// /advocate-program — alias for /grow per spec §3.1. The canonical
// path is /grow; this redirect catches inbound links that use the
// alternative URL the spec also lists.

export default function AdvocateProgramPage() {
  redirect('/grow');
}
