import React, { useState, useMemo, useCallback, memo } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { Menu, MessageSquare, Settings, HelpCircle, SquarePen, LogIn, User as UserIcon, Folder, FolderPlus, X, Type, Wand2, Trash2, ChevronRight, ChevronDown, Video, Image as ImageIcon, FileText, Lightbulb, LayoutGrid } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { useChatContext } from '../../contexts/ChatContext';
import { useFolder } from '../../contexts/FolderContext';
import { MediaGalleryModal } from '../gallery/MediaGalleryModal';
import { toast } from 'sonner';

interface SidebarProps {
    isOpen: boolean;
    onToggle: () => void;
    onOpenSettings: () => void;
}

const SidebarComponent: React.FC<SidebarProps> = ({
    isOpen,
    onToggle,
    onOpenSettings,
}) => {
    const navigate = useNavigate();
    const { user, signIn, signOut } = useAuth();
    const { recentChats, loadChatSession, deleteChat, resetChat, currentSessionId } = useChatContext();

    // Get recent video generations from all chats
    const recentVideoGenerations = React.useMemo(() => {
        const allGenerations = [];
        recentChats.forEach(chat => {
            if (chat.videoGenerations) {
                allGenerations.push(...chat.videoGenerations);
            }
        });

        // Sort by creation time and take recent 5
        return allGenerations
            .sort((a, b) => b.createdAt - a.createdAt)
            .slice(0, 5);
    }, [recentChats]);
    const { folders, folderChats, createFolder, createAIFolder, deleteFolder, isGeneratingFolder } = useFolder();

    const [showFolderModal, setShowFolderModal] = useState(false);
    const [customFolderName, setCustomFolderName] = useState('');
    const [aiGoal, setAiGoal] = useState('');
    const [folderStep, setFolderStep] = useState<'selection' | 'custom-naming' | 'ai-input'>('selection');

    const [expandedFolders, setExpandedFolders] = useState<Record<string, boolean>>({});
    const [isGalleryOpen, setIsGalleryOpen] = useState(false);
    const [isRecentActivityExpanded, setIsRecentActivityExpanded] = useState(true);

    const toggleFolder = useCallback((folderId: string) => {
        setExpandedFolders(prev => ({ ...prev, [folderId]: !prev[folderId] }));
    }, []);

    const handleCreateCustom = useCallback(() => {
        if (!customFolderName.trim()) return;
        createFolder(customFolderName, 'custom');
        resetModal();
    }, [customFolderName, createFolder]);

    const handleCreateAI = useCallback(async () => {
        if (!aiGoal.trim()) return;
        console.log("AI 폴더 생성 시작:", aiGoal);
        try {
            await createAIFolder(aiGoal);
            console.log("AI 폴더 생성 성공, 모달 닫기");
            resetModal();
        } catch (error) {
            console.error("AI 폴더 생성 실패:", error);
            // 에러가 발생해도 모달은 닫아서 사용자가 다른 작업을 할 수 있도록 함
            resetModal();
        }
    }, [aiGoal, createAIFolder]);

    const resetModal = () => {
        setShowFolderModal(false);
        setFolderStep('selection');
        setCustomFolderName('');
        setAiGoal('');
    };

    const getChatIcon = (title: string) => {
        if (title.includes("아이디어") || title.includes("기획")) return <Lightbulb size={14} className="text-yellow-400" />;
        if (title.includes("시나리오") || title.includes("대본") || title.includes("작성")) return <FileText size={14} className="text-blue-400" />;
        if (title.includes("프레임") || title.includes("이미지") || title.includes("디자인")) return <ImageIcon size={14} className="text-purple-400" />;
        if (title.includes("영상") || title.includes("비디오")) return <Video size={14} className="text-red-400" />;
        return <MessageSquare size={14} className="text-neutral-500" />;
    };

  const NavItem = ({ icon: Icon, label, onClick }: { icon: any, label: string, onClick?: () => void }) => (
    <button
      onClick={onClick}
      className="group flex items-center w-full p-3 rounded-xl text-gray-600 dark:text-neutral-400 hover:text-gray-900 dark:hover:text-white hover:bg-gray-100 dark:hover:bg-neutral-800 transition-colors duration-200"
      title={!isOpen ? label : undefined}
    >
            <div className="flex items-center justify-center w-6 h-6 shrink-0">
                <Icon size={20} strokeWidth={1.5} />
            </div>
            <div
                className={`flex items-center whitespace-nowrap overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
          ${isOpen ? 'max-w-[180px] opacity-100 translate-x-0 pl-3' : 'max-w-0 opacity-0 -translate-x-2 pl-0'}
        `}
            >
                <span className="text-sm font-medium">{label}</span>
            </div>
        </button>
    );

    return (
        <>
            <div
                className={`fixed inset-0 bg-black/50 z-40 backdrop-blur-sm transition-opacity duration-300 md:hidden
            ${isOpen ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none'}
        `}
                onClick={onToggle}
            />

    <div
      className={`fixed top-0 left-0 h-full bg-white dark:bg-neutral-900 border-r border-gray-200 dark:border-neutral-800 z-50 transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)] flex flex-col
        ${isOpen ? 'translate-x-0 w-[280px]' : '-translate-x-full md:translate-x-0 md:w-[72px]'}
      `}
    >
                <div className="flex flex-col w-full px-3 pt-4 gap-2">
        <button
            onClick={onToggle}
            className="group flex items-center w-full p-3 rounded-xl transition-all duration-300 mb-2 text-white border border-opacity-50 hover:scale-[1.02] dark:text-white"
            style={{
                backgroundColor: 'var(--point-color)',
                borderColor: 'var(--point-color)',
                boxShadow: '0 0 15px var(--point-bg)',
            }}
            onMouseEnter={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--point-hover)';
                e.currentTarget.style.boxShadow = '0 0 25px var(--point-bg)';
            }}
            onMouseLeave={(e) => {
                e.currentTarget.style.backgroundColor = 'var(--point-color)';
                e.currentTarget.style.boxShadow = '0 0 15px var(--point-bg)';
            }}
        >
                        <div className="flex items-center justify-center w-6 h-6 shrink-0">
                            <span className="md:hidden"><X size={20} strokeWidth={2} /></span>
                            <span className="hidden md:block"><Menu size={20} strokeWidth={2} /></span>
                        </div>
                        <div
                            className={`flex items-center whitespace-nowrap overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                ${isOpen ? 'max-w-[180px] opacity-100 translate-x-0 pl-3' : 'max-w-0 opacity-0 -translate-x-2 pl-0'}
                `}
                        >
                            <span className="text-sm font-bold">메뉴 닫기</span>
                        </div>
                    </button>

                    <NavItem icon={SquarePen} label="새 채팅" onClick={() => {
                        resetChat(null);
                        navigate('/');
                        if (window.innerWidth < 768) onToggle();
                    }} />

                    <NavItem icon={FolderPlus} label="새 폴더" onClick={() => setShowFolderModal(true)} />
                    <NavItem icon={LayoutGrid} label="갤러리" onClick={() => setIsGalleryOpen(true)} />
                </div>

      <div className={`flex-1 overflow-hidden transition-opacity duration-300 bg-white dark:bg-neutral-900 ${isOpen ? 'opacity-100' : 'opacity-0 pointer-events-none'}`}>
          <div className={`px-3 h-full overflow-y-auto custom-scrollbar transition-transform duration-300 ${isOpen ? 'translate-x-0' : '-translate-x-4'}`}>
                        {user ? (
                        <div className="mt-4 mb-6 min-w-[200px]">

                            {/* Folders */}
                            {folders.length > 0 && (
                                <div className="mb-6">
                            <h3 className="px-3 text-[11px] font-bold text-gray-500 dark:text-neutral-500 mb-2 uppercase tracking-wider whitespace-nowrap">
                                프로젝트 폴더
                            </h3>
                                    <div className="space-y-1">
                                        {folders.map((folder) => {
                                            const chats = folderChats[folder.id] || [];
                                            const isExpanded = expandedFolders[folder.id];

                                            return (
                                                <div key={folder.id} className="space-y-0.5">
                                                    <div
                                                        className="w-full flex items-center justify-between px-3 py-2 rounded-lg hover:bg-neutral-800/50 group transition-colors cursor-pointer"
                                                        onClick={() => toggleFolder(folder.id)}
                                                    >
                                                        <div className="flex items-center space-x-2 overflow-hidden flex-1 min-w-0">
                                                            {chats.length > 0 ? (
                                                                isExpanded ? <ChevronDown size={14} className="text-neutral-500 flex-shrink-0" /> : <ChevronRight size={14} className="text-neutral-500 flex-shrink-0" />
                                                            ) : (
                                                                <Folder size={16} className="text-neutral-500 group-hover:text-white transition-colors flex-shrink-0" />
                                                            )}
                                                            <span className={`text-sm truncate ${folder.type === 'shorts-workflow' ? 'text-indigo-400 font-medium' : 'text-neutral-400 group-hover:text-white'}`}>
                                                                {folder.name}
                                                            </span>
                                                        </div>

                                                        <div className="flex items-center space-x-1 opacity-0 group-hover:opacity-100 transition-opacity duration-200">
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    // Logic for new chat inside folder handled by Create New Chat + assigning context in future updates
                                                                    // For now simple alert as we removed complex prop drilling
                                                                    resetChat(folder.id);
                                                                    navigate('/');
                                                                    if (window.innerWidth < 768) onToggle();
                                                                    // Ideally need 'setActiveFolder' in Context
                                                                }}
                                                                className="p-1.5 hover:bg-neutral-700 rounded-md text-neutral-400 hover:text-white transition-all"
                                                                title="폴더에 추가 채팅 생성"
                                                            >
                                                                <SquarePen size={14} />
                                                            </button>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (window.confirm(`'${folder.name}' 폴더와 내부 채팅방을 모두 삭제하시겠습니까?`)) {
                                                                        deleteFolder(folder.id);
                                                                    }
                                                                }}
                                                                className="p-1.5 hover:text-red-400 hover:bg-neutral-700 rounded-md text-neutral-400 transition-all"
                                                                title="폴더 삭제"
                                                            >
                                                                <Trash2 size={14} />
                                                            </button>
                                                        </div>
                                                    </div>

                                                    {isExpanded && chats.length > 0 && (
                                                        <div className="ml-4 pl-2 border-l border-neutral-800 space-y-0.5 mt-1 mb-2 animate-fade-in">
                                                            {chats.map((chat) => (
                                                                <div
                                                                    key={chat.id}
                                                                    onClick={() => {
                                                                        navigate(`/chat/${chat.id}`);
                                                                        if (window.innerWidth < 768) onToggle();
                                                                    }}
                                                                    className={`w-full flex items-center justify-between px-3 py-2 rounded-lg text-left transition-colors text-xs group cursor-pointer
                                                                ${currentSessionId === chat.id ? 'bg-neutral-800 text-white' : 'text-neutral-500 hover:text-neutral-300 hover:bg-neutral-800/30'}
                                                            `}
                                                                >
                                                                    <div className="flex items-center space-x-2 overflow-hidden">
                                                                        {getChatIcon(chat.title)}
                                                                        <span className="truncate">{chat.title}</span>
                                                                    </div>
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            if (window.confirm(`'${chat.title}' 채팅방을 삭제하시겠습니까?`)) {
                                                                                deleteChat(chat.id, folder.id);
                                                                            }
                                                                        }}
                                                                        className="opacity-0 group-hover:opacity-100 p-1 hover:text-red-400 hover:bg-neutral-700 rounded transition-all"
                                                                        title="채팅 삭제"
                                                                    >
                                                                        <Trash2 size={12} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {isGeneratingFolder && (
                                <div className="px-3 py-2 flex items-center space-x-2 animate-pulse">
                                    <Wand2 size={14} className="text-indigo-500 animate-spin" />
                                    <span className="text-xs text-indigo-400">AI가 프로젝트 설계 중...</span>
                                </div>
                            )}

                            <div>
                                <button
                                    onClick={() => setIsRecentActivityExpanded(!isRecentActivityExpanded)}
                                    className="w-full px-3 py-2 flex items-center justify-between text-[11px] font-bold text-gray-500 dark:text-neutral-500 uppercase tracking-wider hover:bg-neutral-800/30 rounded-lg transition-colors"
                                >
                                    <span className="whitespace-nowrap">최근 활동</span>
                                    <div className="transition-transform duration-200 ease-in-out">
                                        {isRecentActivityExpanded ? (
                                            <ChevronDown size={14} className="text-neutral-500 flex-shrink-0" />
                                        ) : (
                                            <ChevronRight size={14} className="text-neutral-500 flex-shrink-0" />
                                        )}
                                    </div>
                                </button>
                                <div
                                    className={`overflow-hidden transition-all duration-300 ease-in-out ${
                                        isRecentActivityExpanded 
                                            ? 'max-h-[1000px] opacity-100' 
                                            : 'max-h-0 opacity-0'
                                    }`}
                                >
                                    <div className="space-y-1 mt-1">
                                        {recentChats.length === 0 ? (
                                            <p className="px-3 text-xs text-neutral-600 py-2">최근 활동이 없습니다.</p>
                                        ) : (
                                            recentChats.map((chat, index) => (
                                                <div
                                                    key={chat.id}
                                                    onClick={() => {
                                                        navigate(`/chat/${chat.id}`);
                                                        if (window.innerWidth < 768) onToggle();
                                                    }}
                                                    className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg hover:bg-neutral-800/50 text-left group transition-all cursor-pointer
                                                ${currentSessionId === chat.id ? 'bg-neutral-800/80' : ''}
                                            `}
                                                    style={{ 
                                                        animation: isRecentActivityExpanded 
                                                            ? `slideDown 0.3s ease-out ${index * 50}ms both` 
                                                            : 'none'
                                                    }}
                                                >
                                                    <div className="flex items-center space-x-3 overflow-hidden">
                                                        <MessageSquare size={16} className="text-neutral-500 group-hover:text-white transition-colors flex-shrink-0" />
                                                        <span className="text-sm text-neutral-400 group-hover:text-white truncate">
                                                            {chat.title}
                                                        </span>
                                                    </div>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (window.confirm(`'${chat.title}' 채팅방을 삭제하시겠습니까?`)) {
                                                                deleteChat(chat.id);
                                                            }
                                                        }}
                                                        className="opacity-0 group-hover:opacity-100 p-1.5 hover:text-red-400 hover:bg-neutral-700/50 rounded-md transition-all"
                                                        title="채팅 삭제"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                            ))
                                        )}
                                    </div>
                                </div>
                            </div>

                        </div>
                        ) : (
                            <div className="mt-4 mb-6 min-w-[200px] px-3 py-2 text-xs text-neutral-600">
                                로그인하면 내 폴더와 채팅 기록이 표시됩니다.
                            </div>
                        )}
                    </div>
                </div>



                {/* Bottom Section */}
                <div className="p-3 pb-6 mt-auto flex flex-col gap-1">
                    {user ? (
                        <div className="mb-2">
                            <button
                                onClick={async () => {
                                    try {
                                        await signOut();
                                        resetChat();
                                        navigate('/');
                                        toast.success("로그아웃되었습니다.");
                                    } catch (e) {
                                        toast.error("로그아웃 실패");
                                    }
                                }}
                                className="group flex items-center w-full p-3 rounded-xl text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors duration-200"
                            >
                                <div className="flex items-center justify-center w-6 h-6 shrink-0">
                                    {user.photoURL ? (
                                        <img src={user.photoURL} alt="Profile" className="w-5 h-5 rounded-full" />
                                    ) : (
                                        <UserIcon size={20} strokeWidth={1.5} />
                                    )}
                                </div>
                                <div
                                    className={`flex items-center whitespace-nowrap overflow-hidden transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]
                        ${isOpen ? 'max-w-[180px] opacity-100 translate-x-0 pl-3' : 'max-w-0 opacity-0 -translate-x-2 pl-0'}
                        `}
                                >
                                    <div className="flex flex-col items-start ml-1">
                                        <span className="text-sm font-medium">{user.displayName || '사용자'}</span>
                                        <span className="text-[10px] text-neutral-500">로그아웃</span>
                                    </div>
                                </div>
                            </button>
                        </div>
                    ) : (
                        <NavItem icon={LogIn} label="로그인" onClick={async () => {
                            try {
                                await signIn();
                                toast.success("로그인되었습니다.");
                            } catch (e) {
                                toast.error("로그인 실패");
                            }
                        }} />
                    )}

                    <NavItem icon={HelpCircle} label="도움말" />
                    <NavItem icon={Settings} label="설정 및 활동" onClick={onOpenSettings} />

                    <div className={`
             mt-4 px-2 flex items-center space-x-2 text-[10px] text-neutral-600 font-medium pt-2 border-t border-neutral-800 overflow-hidden transition-all duration-300
             ${isOpen ? 'opacity-100 max-h-10 border-t-neutral-800 delay-100' : 'opacity-0 max-h-0 border-t-transparent delay-0'}
         `}>
                        <div className="w-1.5 h-1.5 rounded-full bg-neutral-500 flex-shrink-0" />
                        <span className="whitespace-nowrap">대한민국 서울</span>
                    </div>
                </div>
            </div>

            {/* Folder Modal */}
            {showFolderModal && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
                    <div
                        className="absolute inset-0 bg-black/60 backdrop-blur-sm transition-opacity"
                        onClick={resetModal}
                    />
                    <div className="relative bg-white dark:bg-neutral-900 border border-gray-200 dark:border-neutral-800 rounded-2xl w-full max-w-sm shadow-2xl overflow-hidden animate-fade-in">
                        <div className="flex items-center justify-between p-4 border-b border-neutral-800">
                            <h3 className="text-white font-medium">새 폴더 생성</h3>
                            <button onClick={resetModal} className="text-neutral-500 hover:text-white transition-colors">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-6">
                            {folderStep === 'selection' ? (
                                <div className="space-y-3">
                                    <button
                                        onClick={() => setFolderStep('custom-naming')}
                                        className="w-full flex items-center p-4 rounded-xl bg-neutral-800/50 hover:bg-neutral-800 border border-neutral-700/50 hover:border-neutral-600 transition-all group text-left"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-neutral-700 flex items-center justify-center mr-4 group-hover:bg-neutral-600 transition-colors">
                                            <Type size={20} className="text-neutral-300" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold text-neutral-200">사용자 정의 폴더</h4>
                                            <p className="text-xs text-neutral-500 mt-0.5">직접 폴더 이름을 입력하여 생성합니다.</p>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setFolderStep('ai-input')}
                                        className="w-full flex items-center p-4 rounded-xl bg-gradient-to-br from-neutral-800/50 to-indigo-900/20 hover:from-neutral-800 hover:to-indigo-900/30 border border-neutral-700/50 hover:border-indigo-500/30 transition-all group text-left"
                                    >
                                        <div className="w-10 h-10 rounded-lg bg-indigo-900/50 flex items-center justify-center mr-4 group-hover:bg-indigo-800/50 transition-colors">
                                            <Wand2 size={20} className="text-indigo-300" />
                                        </div>
                                        <div>
                                            <h4 className="text-sm font-bold text-indigo-100">AI 추천 자동생성</h4>
                                            <p className="text-xs text-indigo-300/60 mt-0.5">프로젝트 목표에 맞춰 폴더 구조를 자동 설계합니다.</p>
                                        </div>
                                    </button>
                                </div>
                            ) : folderStep === 'custom-naming' ? (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-neutral-500 mb-1.5">폴더 이름</label>
                                        <input
                                            type="text"
                                            value={customFolderName}
                                            onChange={(e) => setCustomFolderName(e.target.value)}
                                            placeholder="프로젝트 이름을 입력하세요"
                                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-neutral-600"
                                            autoFocus
                                            onKeyDown={(e) => e.key === 'Enter' && handleCreateCustom()}
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => setFolderStep('selection')} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:bg-neutral-800 transition-colors">뒤로</button>
                                        <button onClick={handleCreateCustom} disabled={!customFolderName.trim()} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-white text-black hover:bg-neutral-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors">생성하기</button>
                                    </div>
                                </div>
                            ) : (
                                <div className="space-y-4">
                                    <div>
                                        <label className="block text-xs font-medium text-indigo-400 mb-1.5">어떤 프로젝트를 진행하시나요?</label>
                                        <textarea
                                            value={aiGoal}
                                            onChange={(e) => setAiGoal(e.target.value)}
                                            placeholder="예: 유튜브 숏츠 영상 만들기, 판타지 소설 집필 등..."
                                            className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500/50 min-h-[80px] resize-none"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="flex gap-2">
                                        <button onClick={() => setFolderStep('selection')} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium text-neutral-400 hover:bg-neutral-800 transition-colors">뒤로</button>
                                        <button onClick={handleCreateAI} disabled={!aiGoal.trim()} className="flex-1 px-4 py-2.5 rounded-lg text-sm font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors shadow-lg shadow-indigo-900/20">AI 설계 시작</button>
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Gallery Modal */}
            {isGalleryOpen && <MediaGalleryModal onClose={() => setIsGalleryOpen(false)} />}
        </>
    );
};

export const Sidebar = memo(SidebarComponent);
