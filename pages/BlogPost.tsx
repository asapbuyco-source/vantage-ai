import React, { useEffect, useState, useCallback, useMemo } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ArrowLeft, Calendar, Loader2, AlertCircle, BookOpen, Tag } from 'lucide-react';
import { getBlogPost, BlogPost as IBlogPost } from '../services/blogService';
import { useAppContext } from '../context/AppContext';
import DOMPurify from 'isomorphic-dompurify';

export const BlogPost: React.FC = () => {
    const { date } = useParams<{ date: string }>();
    const navigate = useNavigate();
    const { language } = useAppContext();

    const [post, setPost] = useState<IBlogPost | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    const targetDate = date || new Date().toISOString().split('T')[0];

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
                setError(language === 'fr' ? 'Article non trouvé.' : 'Blog post not found for this date.');
            } else {
                setPost(data);
                // Inject dynamic SEO tags
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
        
        // Handle dynamic SEO (Title, Meta Description, Canonical URL)
        const canonicalUrl = `https://vantageai.online/blog/${targetDate}`;
        let link: HTMLLinkElement | null = document.querySelector("link[rel='canonical']");
        
        if (!link) {
            link = document.createElement('link');
            link.setAttribute('rel', 'canonical');
            document.head.appendChild(link);
        }
        link.setAttribute('href', canonicalUrl);

        return () => {
            // Restore default title and canonical on unmount
            document.title = 'Vantage AI Cameroun - Pronostics Foot 1xBet & Premier Bet (IA)';
            if (link) link.setAttribute('href', 'https://vantageai.online/');
        };
    }, [fetchPost, targetDate]);

    return (
        <div className="min-h-screen bg-vantage-bg text-white pb-24">
            {/* Header */}
            <div className="sticky top-0 z-20 bg-[#0d0f14]/90 backdrop-blur-md border-b border-white/5 px-4 py-3 flex items-center gap-3">
                <button
                    onClick={() => navigate('/blog')}
                    className="p-2 rounded-lg bg-white/5 hover:bg-white/10 transition-colors"
                    aria-label="Back to blog"
                >
                    <ArrowLeft size={20} className="text-gray-400" />
                </button>
                <div>
                    <h1 className="text-sm font-bold text-white truncate">
                        {post?.title || (language === 'fr' ? 'Article du Jour' : "Today's Analysis")}
                    </h1>
                    <div className="flex items-center gap-1 text-xs text-gray-500 mt-0.5">
                        <Calendar size={11} />
                        <span>{targetDate}</span>
                    </div>
                </div>
            </div>

            <div className="max-w-2xl mx-auto px-4 py-6">
                {loading ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4">
                        <Loader2 size={32} className="text-vantage-cyan animate-spin" />
                        <p className="text-sm text-gray-500 animate-pulse">
                            {language === 'fr' ? 'Chargement de l\'article...' : 'Loading analysis...'}
                        </p>
                    </div>
                ) : error ? (
                    <div className="flex flex-col items-center justify-center py-24 gap-4 text-center">
                        <AlertCircle size={40} className="text-red-400" />
                        <p className="text-gray-400 text-sm">{error}</p>
                        <Link
                            to="/blog"
                            className="text-vantage-cyan text-sm underline underline-offset-4 hover:text-cyan-300 transition-colors"
                        >
                            {language === 'fr' ? '← Voir tous les articles' : '← View all posts'}
                        </Link>
                    </div>
                ) : post ? (
                    <motion.article
                        initial={{ opacity: 0, y: 16 }}
                        animate={{ opacity: 1, y: 0 }}
                        transition={{ duration: 0.3 }}
                    >
                        {/* Tags */}
                        {post.tags && post.tags.length > 0 && (
                            <div className="flex flex-wrap gap-2 mb-5">
                                {post.tags.map(tag => (
                                    <span
                                        key={tag}
                                        className="flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider bg-vantage-cyan/10 text-vantage-cyan border border-vantage-cyan/20 px-2.5 py-1 rounded-full"
                                    >
                                        <Tag size={9} />
                                        {tag}
                                    </span>
                                ))}
                            </div>
                        )}

                        {/* Excerpt / Lead */}
                        {post.excerpt && (
                            <p className="text-gray-300 text-base italic leading-relaxed mb-6 border-l-2 border-vantage-cyan/50 pl-4">
                                {post.excerpt}
                            </p>
                        )}

                        {/* Blog HTML Content */}
                        <div
                            className="prose prose-invert prose-sm max-w-none
                        [&>h2]:text-vantage-cyan [&>h2]:font-bold [&>h2]:text-lg [&>h2]:mt-8 [&>h2]:mb-3
                        [&>h3]:text-gray-200 [&>h3]:font-semibold [&>h3]:mt-6 [&>h3]:mb-2
                        [&>p]:text-gray-300 [&>p]:leading-relaxed [&>p]:mb-4
                        [&>ul]:text-gray-300 [&>ul]:pl-5 [&>ul]:mb-4 [&>ul>li]:mb-1
                        [&>ol]:text-gray-300 [&>ol]:pl-5 [&>ol]:mb-4 [&>ol>li]:mb-1
                        [&>strong]:text-white [&_strong]:text-white
                        [&>a]:text-vantage-cyan [&_a]:underline"
                            dangerouslySetInnerHTML={{ __html: cleanContent }}
                        />

                        {/* Footer navigation */}
                        <div className="mt-10 pt-6 border-t border-white/5 flex justify-between items-center">
                            <Link
                                to="/blog"
                                className="flex items-center gap-2 text-sm text-gray-500 hover:text-vantage-cyan transition-colors"
                            >
                                <BookOpen size={16} />
                                {language === 'fr' ? 'Tous les articles' : 'All posts'}
                            </Link>
                            <Link
                                to={`/predictions/${targetDate}`}
                                className="text-sm text-vantage-cyan hover:text-cyan-300 transition-colors underline underline-offset-4"
                            >
                                {language === 'fr' ? 'Voir les pronostics →' : 'View predictions →'}
                            </Link>
                        </div>
                    </motion.article>
                ) : null}
            </div>
        </div>
    );
};
