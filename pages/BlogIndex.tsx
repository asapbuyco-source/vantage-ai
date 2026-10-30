import React, { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronRight, Loader2, BookOpen, Zap, Calculator, GraduationCap, BarChart3, Lightbulb } from 'lucide-react';
import { getRecentBlogPosts } from '../services/blogService';
import { PlayStoreCTA } from '../components/PlayStoreCTA';
import { SiteNav } from '../components/SiteNav';
import { SiteFooter } from '../components/SiteFooter';
import { useAppContext } from '../context/AppContext';

type PostMeta = {
    date: string;
    id?: string;
    title: string;
    excerpt: string;
    tags?: string[];
    generatedAt: string;
};

const isGuide = (p: PostMeta) => p.date === 'evergreen' || (p.id || '').startsWith('evergreen_');

const PostCard: React.FC<{ post: PostMeta; index: number; language: string }> = ({ post, index, language }) => {
    const today = new Date().toISOString().split('T')[0];
    const guide = isGuide(post);
    const isToday = post.date === today;
    const dateObj = !guide ? new Date(`${post.date}T12:00:00`) : null;
    const validDate = dateObj && !Number.isNaN(dateObj.getTime());

    return (
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.04, duration: 0.25 }}>
            <Link
                to={`/blog/${post.id || post.date}`}
                className={`flex items-start gap-4 p-4 rounded-2xl border transition-all hover:bg-white/5 active:scale-[0.99] group ${
                    isToday ? 'bg-vantage-cyan/5 border-vantage-cyan/20' : 'bg-white/[0.03] border-white/5'
                }`}
            >
                <div className={`shrink-0 w-12 h-12 rounded-xl flex flex-col items-center justify-center text-center ${
                    guide ? 'bg-violet-500/15 text-violet-300' : isToday ? 'bg-vantage-cyan text-black' : 'bg-white/5 text-gray-400'
                }`}>
                    {guide ? (
                        <Lightbulb size={20} />
                    ) : validDate ? (
                        <>
                            <span className="text-[10px] font-bold uppercase leading-none">
                                {dateObj!.toLocaleString(language === 'fr' ? 'fr-FR' : 'en-US', { month: 'short' })}
                            </span>
                            <span className="text-xl font-bold leading-none mt-0.5">{dateObj!.getDate()}</span>
                        </>
                    ) : (
                        <BookOpen size={18} />
                    )}
                </div>

                <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-1">
                        {guide && (
                            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-violet-300 bg-violet-500/15 px-1.5 py-0.5 rounded-full">
                                {language === 'fr' ? 'Guide' : 'Guide'}
                            </span>
                        )}
                        {isToday && (
                            <span className="flex items-center gap-1 text-[9px] font-bold uppercase tracking-wider text-black bg-vantage-cyan px-1.5 py-0.5 rounded-full">
                                <Zap size={8} className="fill-black" />
                                {language === 'fr' ? 'Aujourd’hui' : 'Today'}
                            </span>
                        )}
                    </div>
                    <h2 className="text-sm font-bold text-white line-clamp-2 leading-snug group-hover:text-vantage-cyan transition-colors">
                        {post.title || `${language === 'fr' ? 'Pronostics du' : 'Predictions for'} ${post.date}`}
                    </h2>
                    {post.excerpt && <p className="text-xs text-gray-500 line-clamp-2 mt-1 leading-relaxed">{post.excerpt}</p>}
                    {post.tags && post.tags.length > 0 && (
                        <div className="flex gap-1.5 mt-2 flex-wrap">
                            {post.tags.slice(0, 3).map(t => (
                                <span key={t} className="text-[9px] font-bold uppercase tracking-wider bg-white/5 text-gray-500 px-2 py-0.5 rounded-full">
                                    {t}
                                </span>
                            ))}
                        </div>
                    )}
                </div>

                <ChevronRight size={18} className="text-gray-600 group-hover:text-vantage-cyan transition-colors shrink-0 mt-1" />
            </Link>
        </motion.div>
    );
};

export const BlogIndex: React.FC = () => {
    const { language } = useAppContext();
    const [posts, setPosts] = useState<PostMeta[]>([]);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        document.title = language === 'fr'
            ? 'Blog Pronostics IA | Vantage AI Cameroun'
            : 'AI Football Predictions Blog | Vantage AI Cameroon';

        getRecentBlogPosts(30).then(data => {
            setPosts(data);
            setLoading(false);
        });

        return () => {
            document.title = 'Vantage AI Cameroon - AI Football Predictions for 1xBet & Premier Bet';
        };
    }, [language]);

    const guides = posts.filter(isGuide);
    const daily = posts.filter(p => !isGuide(p));

    return (
        <div className="min-h-screen bg-vantage-bg text-white">
            <SiteNav />
            <div className="max-w-2xl mx-auto px-4 pt-6 pb-10">
                {/* Breadcrumb */}
                <nav className="flex items-center gap-1.5 text-[11px] text-gray-500 mb-4">
                    <Link to="/" className="hover:text-vantage-cyan">{language === 'fr' ? 'Accueil' : 'Home'}</Link>
                    <ChevronRight size={11} />
                    <span className="text-gray-300">Blog</span>
                </nav>

                <div className="flex items-center gap-3 mb-2">
                    <div className="w-9 h-9 rounded-xl bg-vantage-cyan/10 border border-vantage-cyan/20 flex items-center justify-center">
                        <BookOpen size={18} className="text-vantage-cyan" />
                    </div>
                    <h1 className="text-2xl font-orbitron font-bold">{language === 'fr' ? 'Analyses & Guides' : 'Analyses & Guides'}</h1>
                </div>
                <p className="text-sm text-gray-500 ml-12 mb-5">
                    {language === 'fr'
                        ? 'Articles quotidiens et guides stratégiques de notre moteur.'
                        : 'Daily articles and strategy guides from our engine.'}
                </p>

                {/* Quick navigation */}
                <div className="grid grid-cols-3 gap-2 mb-6">
                    <Link to="/tools" className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-vantage-cyan/40 transition-colors">
                        <Calculator size={14} className="text-vantage-cyan" />
                        <span className="text-[11px] font-bold text-white">{language === 'fr' ? 'Outils' : 'Tools'}</span>
                    </Link>
                    <Link to="/learn" className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-vantage-cyan/40 transition-colors">
                        <GraduationCap size={14} className="text-vantage-cyan" />
                        <span className="text-[11px] font-bold text-white">{language === 'fr' ? 'Apprendre' : 'Learn'}</span>
                    </Link>
                    <Link to="/stats" className="flex items-center gap-1.5 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5 hover:border-vantage-cyan/40 transition-colors">
                        <BarChart3 size={14} className="text-vantage-cyan" />
                        <span className="text-[11px] font-bold text-white">{language === 'fr' ? 'Résultats' : 'Results'}</span>
                    </Link>
                </div>

                {loading ? (
                    <div className="flex items-center justify-center py-20">
                        <Loader2 size={28} className="text-vantage-cyan animate-spin" />
                    </div>
                ) : posts.length === 0 ? (
                    <div className="text-center py-20 text-gray-500">
                        <BookOpen size={40} className="mx-auto mb-4 text-gray-600" />
                        <p className="font-medium">{language === 'fr' ? 'Aucun article disponible pour le moment.' : 'No posts available yet.'}</p>
                    </div>
                ) : (
                    <div className="space-y-6">
                        {guides.length > 0 && (
                            <section>
                                <h2 className="text-[11px] font-black uppercase tracking-widest text-violet-300 mb-2">
                                    {language === 'fr' ? 'Guides & stratégie' : 'Guides & Strategy'}
                                </h2>
                                <div className="space-y-3">
                                    {guides.map((post, i) => <PostCard key={post.id || post.date} post={post} index={i} language={language} />)}
                                </div>
                            </section>
                        )}

                        {daily.length > 0 && (
                            <section>
                                <h2 className="text-[11px] font-black uppercase tracking-widest text-gray-400 mb-2">
                                    {language === 'fr' ? 'Analyses du jour' : 'Daily Analyses'}
                                </h2>
                                <div className="space-y-3">
                                    {daily.map((post, i) => <PostCard key={post.id || post.date} post={post} index={i} language={language} />)}
                                </div>
                            </section>
                        )}
                    </div>
                )}

                <div className="mt-6">
                    <PlayStoreCTA variant="banner" />
                </div>
            </div>
            <SiteFooter />
        </div>
    );
};
