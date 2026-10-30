import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Calendar, Loader2, AlertCircle, BookOpen, Tag, ChevronRight } from 'lucide-react';
import { getBlogPost, getRecentBlogPosts, BlogPost as IBlogPost } from '../services/blogService';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { SiteNav } from '../components/SiteNav';
import { SiteFooter } from '../components/SiteFooter';
import { useAppContext } from '../context/AppContext';
import DOMPurify from 'isomorphic-dompurify';

export const BlogPost: React.FC = () => {
    const { date } = useParams<{ date: string }>();
    const navigate = useNavigate();
    const { language } = useAppContext();

    const [post, setPost] = useState<IBlogPost | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [related, setRelated] = useState<{ id?: string; date: string; title: string }[]>([]);

    const targetDate = date || new Date().toISOString().split('T')[0];
    const isGuide = targetDate === 'evergreen' || targetDate.startsWith('evergreen_');

    const cleanContent = useMemo(() => {
        if (!post?.content) return '';
        return DOMPurify.sanitize(post.content, {
            ALLOWED_TAGS: ["p", "h2", "h3", "ul", "ol", "li", "strong", "em", "b", "i", "br", "span", "a"],
            ALLOWED_ATTR: ["href", "target", "rel"],
            FORBID_TAGS: ["script", "style", "iframe", "object", "embed", "xmp"],
            ADD_ATTR: ["target"],
        });
    }, [post?.content]);

    const fetchPost = useCallback(async () => {
        setLoading(true);
        setError(null);
        try {
            const data = await getBlogPost(targetDate);
            if (!data) {
                setError(language === 'fr' ? 'Article non trouvé.' : 'Blog post not found.');
            } else {
                setPost(data);
                document.title = data.title || `Football Predictions ${targetDate} | Vantage AI`;
                const metaDesc = document.querySelector('meta[name="description"]');
                if (metaDesc && data.excerpt) metaDesc.setAttribute('content', data.excerpt);
            }
        } catch {
            setError(language === 'fr' ? 'Erreur de chargement.' : 'Failed to load blog post.');
        } finally {
            setLoading(false);
        }
    }, [targetDate, language]);

    useEffect(() => {
        fetchPost();

        getRecentBlogPosts(12).then(list => {
            setRelated(list.filter(p => (p.id || p.date) !== targetDate).slice(0, 4));
        });

        const canonicalUrl = `https://vantageai.online/blog/${targetDate}`;
        let link: HTMLLinkElement | null = document.querySelector("link[rel='canonical']");

        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'canonical');
            document.head.appendChild(link);
        }
        link.setAttribute('href', canonicalUrl);

        return () => {
            document.title = 'Vantage AI Cameroon - AI Football Predictions for 1xBet & Premier Bet';
            if (link) link.setAttribute('href', 'https://vantageai.online/');
        };
    }, [fetchPost, targetDate]);

    return (
        <div className="min-h-screen bg-vantage-bg text-white">
            <SiteNav />
            <div className="max-w-2xl mx-auto px-4 py-5">
                {/* Breadcrumb + back */}
                <div className="flex items-center justify-between mb-4">
                    <nav className="flex items-center gap-1.5 text-[11px] text-gray-500 min-w-0">
                        <Link to="/" className="hover:text-vantage-cyan">{language === 'fr' ? 'Accueil' : 'Home'}</Link>
                        <ChevronRight size={11} />
                        <Link to="/blog" className="hover:text-vantage-cyan">Blog</Link>
                        <ChevronRight size={11} />
                        <span className="text-gray-300 truncate max-w-[140px]">{isGuide ? (language === 'fr' ? 'Guide' : 'Guide') : targetDate}</span>
                    </nav>
                    <button
                        onClick={() => navigate('/blog')}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-white/5 hover:bg-white/10 transition-colors text-[11px] font-bold text-gray-300 shrink-0"
                    >
                        <ArrowLeft size={13} />
                        {language === 'fr' ? 'Blog' : 'Blog'}
                    </button>
                </div>

                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <Loader2 size={32} className="text-vantage-cyan animate-spin" />
                        <p className="text-sm text-gray-500 animate-pulse">{language === 'fr' ? 'Chargement de l’article…' : 'Loading article…'}</p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                        <AlertCircle size={40} className="text-red-400" />
                        <p className="text-gray-400 text-sm">{error}</p>
                        <Link to="/blog" className="text-vantage-cyan text-sm underline underline-offset-4">
                            {language === 'fr' ? '← Voir tous les articles' : '← View all posts'}
                        </Link>
                    </div>
                ) : post ? (
                    <motion.article initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.3 }}>
                        <div className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-3">
                            <Calendar size={11} />
                            <span>{isGuide ? (language === 'fr' ? 'Guide' : 'Guide') : targetDate}</span>
                        </div>

                        {post.tags && post.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-5">
                                {post.tags.map(tag => (
                                    <span key={tag} className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-vantage-cyan/10 text-vantage-cyan border border-vantage-cyan/20 px-2.5 py-1 rounded-full">
                                        <Tag size={9} />
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}

                        {post.excerpt && (
                            <p className="text-gray-300 text-base italic leading-relaxed mb-6 border-l-2 border-vantage-cyan/50 pl-4">{post.excerpt}</p>
                        )}

                        <div
                            className="prose prose-invert prose-sm max-w-none
                        [&>h1]:text-white [&>h1]:font-black [&>h1]:text-xl [&>h1]:mb-4
                        [&>h2]:text-vantage-cyan [&>h2]:font-bold [&>h2]:text-lg [&>h2]:mt-8 [&>h2]:mb-3
                        [&>h3]:text-gray-200 [&>h3]:font-semibold [&>h3]:mt-6 [&>h3]:mb-2
                        [&>p]:text-gray-300 [&>p]:leading-relaxed [&>p]:mb-4
                        [&>ul]:text-gray-300 [&>ul]:pl-5 [&>ul]:mb-4 [&>ul>li]:mb-1
                        [&>ol]:text-gray-300 [&>ol]:pl-5 [&>ol]:mb-4 [&>ol>li]:mb-1
                        [&>strong]:text-white [&_strong]:text-white
                        [&>a]:text-vantage-cyan [&_a]:underline"
                            dangerouslySetInnerHTML={{ __html: cleanContent }}
                        />

                        <div className="mt-8 pt-5 border-t border-white/5 flex flex-wrap justify-between items-center gap-3">
                            <Link to="/blog" className="flex items-center gap-2 text-sm text-gray-500 hover:text-vantage-cyan transition-colors">
                                <BookOpen size={16} />
                                {language === 'fr' ? 'Tous les articles' : 'All posts'}
                            </Link>
                            <Link to="/" className="text-sm text-vantage-cyan hover:text-cyan-300 transition-colors underline underline-offset-4">
                                {language === 'fr' ? 'Voir les pronostics →' : 'View predictions →'}
                            </Link>
                        </div>
                    </motion.article>
                ) : null}

                {related.length > 0 && (
                    <section className="mt-8">
                        <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">
                            {language === 'fr' ? 'À lire aussi' : 'Read next'}
                        </h2>
                        <div className="space-y-2">
                            {related.map(r => (
                                <Link
                                    key={r.id || r.date}
                                    to={`/blog/${r.id || r.date}`}
                                    className="flex items-center justify-between gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-vantage-cyan/40 transition-colors"
                                >
                                    <span className="text-[12px] font-bold text-white truncate">{r.title}</span>
                                    <ChevronRight size={14} className="text-gray-500 shrink-0" />
                                </Link>
                            ))}
                        </div>
                    </section>
                )}

                <div className="mt-6">
                    <PlayStoreCTA variant="card" />
                </div>
            </div>
            <SiteFooter />
        </div>
    );
};
