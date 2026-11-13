package credentials

// InitServer restores the persisted mode even when a gateway only has a valid
// session cookie, not the user's login password. A locked existing store must
// remain unlockable; it must never be mistaken for a fresh setup.
func (s *Store) InitServer(password string) error {
	meta, err := ReadMeta(s.dataDir)
	if err != nil {
		return err
	} // Never overwrite unreadable metadata.
	if meta == nil {
		if password != "" {
			return s.Setup(ModeMasterPassword, password)
		}
		return nil
	}
	if err := s.AutoUnlock(); err != nil {
		return err
	}
	if meta.Mode == ModeMasterPassword && password != "" && !s.Unlocked() {
		return s.Unlock(password)
	}
	return nil
}
