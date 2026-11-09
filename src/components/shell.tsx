import Link from 'next/link';
export function Header() { return <header className="header container"><Link className="brand" href="/" aria-label="ritnave, inicio">ritnave<span>·</span></Link><nav aria-label="Principal"><Link href="/login">Entrar</Link><Link className="button secondary" href="/registro">Crear cuenta</Link></nav></header>; }
