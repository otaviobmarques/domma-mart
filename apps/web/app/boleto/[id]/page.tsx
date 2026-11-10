'use client';
import { use, useEffect } from 'react';
/** O boleto é exibido pela mesma tela de obrigado (estado "Ainda pendente"). */
export default function Boleto({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  useEffect(() => { location.replace(`/obrigado/${id}${location.search}`); }, [id]);
  return null;
}
