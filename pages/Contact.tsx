import React, { useEffect, useState } from 'react';
import { Mail, Send, MessageCircle, Clock, HelpCircle } from 'lucide-react';
import { Link } from 'react-router-dom';
import { PublicLayout } from '../components/PublicLayout';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { useAppContext } from '../context/AppContext';

const SUPPORT_EMAIL = 'asapbuyco@gmail.com';

export const Contact: React.FC = () => {
    const { language } = useAppContext();
    const fr = language === 'fr';
    const [name, setName] = useState('');
    const [email, setEmail] = useState('');
    const [subject, setSubject] = useState('');
    const [message, setMessage] = useState('');

    useEffect(() => {
        document.title = fr ? 'Contact | Vantage AI' : 'Contact Us | Vantage AI';
    }, [fr]);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        const body = `${message}\n\n— ${name}${email ? ` (${email})` : ''}`;
        const url = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent(subject || 'Vantage AI enquiry')}&body=${encodeURIComponent(body)}`;
        window.location.href = url;
    };

    const inputCls = 'w-full rounded-xl bg-white/5 border border-white/10 px-3 py-2.5 text-sm text-white outline-none focus:border-vantage-cyan/60';

    return (
        <PublicLayout>
            <div className="mb-6">
                <h1 className="text-2xl font-black font-orbitron">{fr ? 'Contactez-nous' : 'Contact Us'}</h1>
                <p className="text-sm text-gray-500 mt-2">
                    {fr ? 'Une question, un bug ou une demande de partenariat ? Nous lisons tout.' : 'A question, a bug or a partnership request? We read everything.'}
                </p>
            </div>

            <div className="grid sm:grid-cols-2 gap-3 mb-6">
                <a href={`mailto:${SUPPORT_EMAIL}`} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-vantage-cyan/40 transition-colors">
                    <Mail size={18} className="text-vantage-cyan mb-2" />
                    <p className="text-xs font-black text-white">{fr ? 'Email' : 'Email'}</p>
                    <p className="text-[11px] text-gray-500 break-all">{SUPPORT_EMAIL}</p>
                </a>
                <a href="https://t.me/vantageai" target="_blank" rel="noopener noreferrer" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-vantage-cyan/40 transition-colors">
                    <Send size={18} className="text-vantage-cyan mb-2" />
                    <p className="text-xs font-black text-white">Telegram</p>
                    <p className="text-[11px] text-gray-500">@vantageai</p>
                </a>
                <a href="https://wa.me/237688203629" target="_blank" rel="noopener noreferrer" className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 hover:border-vantage-cyan/40 transition-colors">
                    <MessageCircle size={18} className="text-emerald-500 mb-2" />
                    <p className="text-xs font-black text-white">WhatsApp</p>
                    <p className="text-[11px] text-gray-500">{fr ? 'Support communautaire' : 'Community support'}</p>
                </a>
                <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-4">
                    <Clock size={18} className="text-amber-400 mb-2" />
                    <p className="text-xs font-black text-white">{fr ? 'Délai de réponse' : 'Response time'}</p>
                    <p className="text-[11px] text-gray-500">{fr ? 'Sous 24–48h' : 'Within 24–48h'}</p>
                </div>
            </div>

            <form onSubmit={handleSubmit} className="rounded-2xl border border-white/10 bg-white/[0.03] p-4 space-y-3">
                <h2 className="text-sm font-black text-white">{fr ? 'Envoyer un message' : 'Send a message'}</h2>
                <div className="grid sm:grid-cols-2 gap-3">
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 block">{fr ? 'Nom' : 'Name'}</label>
                        <input className={inputCls} value={name} onChange={e => setName(e.target.value)} placeholder={fr ? 'Votre nom' : 'Your name'} required />
                    </div>
                    <div>
                        <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 block">Email</label>
                        <input type="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" />
                    </div>
                </div>
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 block">{fr ? 'Sujet' : 'Subject'}</label>
                    <input className={inputCls} value={subject} onChange={e => setSubject(e.target.value)} placeholder={fr ? 'Comment pouvons-nous aider ?' : 'How can we help?'} required />
                </div>
                <div>
                    <label className="text-[10px] font-bold uppercase tracking-widest text-gray-500 mb-1 block">Message</label>
                    <textarea className={`${inputCls} min-h-[110px]`} value={message} onChange={e => setMessage(e.target.value)} placeholder={fr ? 'Votre message…' : 'Your message…'} required />
                </div>
                <button type="submit" className="w-full rounded-xl bg-vantage-cyan text-black py-2.5 text-sm font-black">
                    {fr ? 'Envoyer' : 'Send message'}
                </button>
                <p className="text-[10px] text-gray-600">
                    {fr ? 'Le formulaire ouvre votre application email avec le message pré-rempli.' : 'The form opens your email app with the message pre-filled.'}
                </p>
            </form>

            <Link to="/faq" className="mt-4 inline-flex items-center gap-1.5 text-[11px] font-bold text-vantage-cyan">
                <HelpCircle size={13} /> {fr ? 'Consultez la FAQ avant de nous écrire' : 'Check the FAQ before writing to us'}
            </Link>

            <PlayStoreCTA variant="card" className="mt-4" />
        </PublicLayout>
    );
};
