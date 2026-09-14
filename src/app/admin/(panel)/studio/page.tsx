import { redirect } from 'next/navigation';

// The img2threejs studio now lives in the model workshop (tab "Mô hình" of a unit or asset).
export default function StudioPage() {
  redirect('/models');
}
