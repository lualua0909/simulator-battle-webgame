import { UserEditor } from '@/components/admin/UsersAdmin';

export default async function UserPage({ params }: { params: Promise<{ uid: string }> }) {
  const { uid } = await params;
  return <UserEditor uid={uid} />;
}
