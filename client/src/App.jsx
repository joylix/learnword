import React from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import Layout from './components/Layout';
import Home from './pages/Home';
import LevelTest from './pages/LevelTest';
import Reading from './pages/Reading';
import ArticleList from './pages/ArticleList';
import ArticleDetail from './pages/ArticleDetail';
import VocabManager from './pages/VocabManager';
import VocabDetail from './pages/VocabDetail';
import ReviewList from './pages/ReviewList';
import TagsManager from './pages/TagsManager';
import Settings from './pages/Settings';
import ExportImport from './pages/ExportImport';
import DictionaryManager from './pages/DictionaryManager';

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/level-test" element={<LevelTest />} />
          <Route path="/reading/:articleId" element={<Reading />} />
          <Route path="/articles" element={<ArticleList />} />
          <Route path="/articles/new" element={<ArticleDetail />} />
          <Route path="/articles/:id" element={<ArticleDetail />} />
          <Route path="/vocab" element={<VocabManager />} />
          <Route path="/vocab/:wordId" element={<VocabDetail />} />
          <Route path="/review" element={<ReviewList />} />
          <Route path="/tags" element={<TagsManager />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/export" element={<ExportImport />} />
          <Route path="/dictionary" element={<DictionaryManager />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </Layout>
    </BrowserRouter>
  );
}
